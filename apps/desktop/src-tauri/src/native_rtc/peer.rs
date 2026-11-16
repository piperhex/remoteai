use super::{channel::Channel, model::*};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::{mpsc, Mutex, Notify};
use webrtc::{
    api::{
        interceptor_registry::register_default_interceptors, media_engine::MediaEngine,
        setting_engine::SettingEngine, APIBuilder,
    },
    data_channel::data_channel_init::RTCDataChannelInit,
    ice_transport::ice_server::RTCIceServer,
    interceptor::registry::Registry,
    peer_connection::{
        configuration::RTCConfiguration, policy::ice_transport_policy::RTCIceTransportPolicy,
        sdp::session_description::RTCSessionDescription, RTCPeerConnection,
    },
};

pub(crate) struct Peer {
    pub(super) rtc: Arc<RTCPeerConnection>,
    pub(super) channels: Mutex<HashMap<String, Arc<Channel>>>,
    events: mpsc::Sender<Event>,
    incoming: Mutex<mpsc::Receiver<Event>>,
    binary: Mutex<VecDeque<BinaryPacket>>,
    signaling: Mutex<()>,
    closed: AtomicBool,
    pub(super) stopped: Notify,
    transports: super::turn_transport::Transports,
    pub(super) media: super::media::Media,
}

impl Peer {
    pub(crate) async fn new(config: Configuration) -> Result<Arc<Self>> {
        Self::configured(config, SettingEngine::default()).await
    }

    pub(super) async fn configured(
        config: Configuration,
        settings: SettingEngine,
    ) -> Result<Arc<Self>> {
        config.validate()?;
        let mut media = MediaEngine::default();
        media
            .register_default_codecs()
            .map_err(|_| Error::Transport)?;
        let registry = register_default_interceptors(Registry::new(), &mut media)
            .map_err(|_| Error::Transport)?;
        let api = APIBuilder::new()
            .with_setting_engine(settings)
            .with_media_engine(media)
            .with_interceptor_registry(registry)
            .build();
        let mut ice_servers: Vec<_> = config
            .ice_servers
            .into_iter()
            .map(|server| RTCIceServer {
                urls: server.urls,
                username: server.username,
                credential: server.credential,
            })
            .collect();
        let transports = super::turn_transport::prepare(&mut ice_servers).await?;
        let rtc = api
            .new_peer_connection(RTCConfiguration {
                ice_servers,
                ice_transport_policy: if config.relay_only {
                    RTCIceTransportPolicy::Relay
                } else {
                    RTCIceTransportPolicy::All
                },
                ..Default::default()
            })
            .await
            .map_err(|_| Error::Transport)?;
        let (events, incoming) = mpsc::channel(128);
        let peer = Arc::new(Self {
            rtc: Arc::new(rtc),
            channels: Mutex::new(HashMap::new()),
            events,
            incoming: Mutex::new(incoming),
            binary: Mutex::new(VecDeque::new()),
            signaling: Mutex::new(()),
            closed: AtomicBool::new(false),
            stopped: Notify::new(),
            transports,
            media: super::media::Media::default(),
        });
        super::events::bind(&peer);
        super::media::bind(&peer, config.receive_media);
        Ok(peer)
    }

    pub(super) fn emit(&self, event: Event) {
        if !self.closed.load(Ordering::Acquire) && self.events.try_send(event).is_err() {
            self.stop();
        }
    }

    pub(crate) fn stop(&self) {
        self.closed.store(true, Ordering::Release);
        self.stopped.notify_waiters();
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    pub(crate) async fn close(&self) {
        self.stop();
        if let Err(error) = self.rtc.close().await {
            eprintln!("Native RTC close failed: {error}");
        }
        self.transports.close();
        self.channels.lock().await.clear();
        self.binary.lock().await.clear();
    }

    pub(crate) async fn poll(&self) -> Result<Vec<Event>> {
        let mut incoming = self.incoming.try_lock().map_err(|_| Error::Capacity)?;
        if self.is_closed() {
            return Ok(vec![Event::Closed]);
        }
        let first = tokio::select! {
            value = incoming.recv() => value,
            _ = self.stopped.notified() => Some(Event::Closed),
            _ = tokio::time::sleep(Duration::from_secs(1)) => None,
        };
        let mut events: Vec<_> = first.into_iter().collect();
        while events.len() < 16 {
            match incoming.try_recv() {
                Ok(event) => events.push(event),
                Err(_) => break,
            }
        }
        Ok(events)
    }

    pub(super) async fn push_binary(&self, packet: BinaryPacket) {
        let mut queue = self.binary.lock().await;
        if queue.len() >= 512
            || queue.iter().map(|item| item.bytes.len()).sum::<usize>() + packet.bytes.len()
                > MAX_BINARY_BYTES
        {
            drop(queue);
            self.stop();
            return;
        }
        let notify = queue.is_empty();
        queue.push_back(packet);
        if notify {
            self.emit(Event::BinaryReady);
        }
    }

    pub(crate) async fn receive_binary(&self) -> Result<Vec<u8>> {
        // Amortize IPC across file records. A single large video frame still remains atomic.
        const BATCH_BYTES: usize = 256 * 1024;
        const BATCH_PACKETS: usize = 32;
        let mut queue = self.binary.lock().await;
        let mut output = Vec::new();
        for _ in 0..BATCH_PACKETS {
            let Some(packet) = queue.pop_front() else {
                break;
            };
            let header = serde_json::to_vec(&packet.header).map_err(|_| Error::Invalid)?;
            output.extend_from_slice(&(header.len() as u32).to_be_bytes());
            output.extend_from_slice(&(packet.bytes.len() as u32).to_be_bytes());
            output.extend_from_slice(&header);
            output.extend_from_slice(&packet.bytes);
            if output.len() >= BATCH_BYTES {
                break;
            }
        }
        Ok(output)
    }

    pub(crate) async fn create_channel(self: &Arc<Self>, spec: ChannelSpec) -> Result<()> {
        spec.validate()?;
        let mut channels = self.channels.lock().await;
        if self.is_closed() || channels.len() >= MAX_CHANNELS || channels.contains_key(&spec.key) {
            return Err(Error::Capacity);
        }
        let rtc = self
            .rtc
            .create_data_channel(
                &spec.label,
                Some(RTCDataChannelInit {
                    ordered: Some(true),
                    negotiated: spec.negotiated,
                    ..Default::default()
                }),
            )
            .await
            .map_err(|_| Error::Transport)?;
        let channel = Channel::bind(self, spec.clone(), rtc).await;
        channels.insert(spec.key, channel);
        Ok(())
    }

    pub(super) async fn channel(&self, key: &str) -> Result<Arc<Channel>> {
        if self.is_closed() {
            return Err(Error::Closed);
        }
        self.channels
            .lock()
            .await
            .get(key)
            .cloned()
            .ok_or(Error::Closed)
    }

    pub(crate) async fn operate(
        self: &Arc<Self>,
        operation: Operation,
    ) -> Result<serde_json::Value> {
        if self.is_closed() {
            return Err(Error::Closed);
        }
        let _serial = self.signaling.lock().await;
        match operation {
            Operation::Offer => description(self.rtc.create_offer(None).await),
            Operation::Answer => description(self.rtc.create_answer(None).await),
            Operation::Local { description } => {
                self.rtc
                    .set_local_description(parse_description(description)?)
                    .await
                    .map_err(|_| Error::Transport)?;
                Ok(serde_json::Value::Null)
            }
            Operation::Remote { description } => {
                self.rtc
                    .set_remote_description(parse_description(description)?)
                    .await
                    .map_err(|_| Error::Transport)?;
                Ok(serde_json::Value::Null)
            }
            Operation::Candidate { candidate } => {
                if candidate.candidate.len() > 4096 {
                    return Err(Error::Invalid);
                }
                self.rtc
                    .add_ice_candidate(candidate)
                    .await
                    .map_err(|_| Error::Transport)?;
                Ok(serde_json::Value::Null)
            }
            Operation::CreateChannel { channel } => {
                self.create_channel(channel).await?;
                Ok(serde_json::Value::Null)
            }
            Operation::CloseChannel { key } => {
                let channel = self.channels.lock().await.remove(&key);
                if let Some(channel) = channel {
                    channel.rtc.close().await.map_err(|_| Error::Transport)?;
                }
                Ok(serde_json::Value::Null)
            }
            Operation::Stats => {
                serde_json::to_value(self.rtc.get_stats().await).map_err(|_| Error::Transport)
            }
            Operation::KeyFrame => {
                self.request_keyframe().await?;
                Ok(serde_json::Value::Null)
            }
        }
    }
}

fn description(value: webrtc::error::Result<RTCSessionDescription>) -> Result<serde_json::Value> {
    let value = value.map_err(|_| Error::Transport)?;
    serde_json::to_value(Description {
        r#type: value.sdp_type.to_string(),
        sdp: value.sdp,
    })
    .map_err(|_| Error::Invalid)
}

fn parse_description(value: Description) -> Result<RTCSessionDescription> {
    if value.sdp.len() > 256 * 1024 {
        return Err(Error::Capacity);
    }
    match value.r#type.as_str() {
        "offer" => RTCSessionDescription::offer(value.sdp),
        "answer" => RTCSessionDescription::answer(value.sdp),
        _ => return Err(Error::Invalid),
    }
    .map_err(|_| Error::Invalid)
}
