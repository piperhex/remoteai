//! Bounded native-only inboxes. Application services authenticate records after routing by transfer ID.
use super::{bulk::Target, channel::Channel, model::*, peer::Peer, State};
use bytes::Bytes;
use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

const MAX_STREAMS: usize = 8;
const QUEUED_RECORDS: usize = 128;
const MAX_RECORD_BYTES: usize = 16 * 1024;
const DEADLINE: Duration = Duration::from_secs(30);

#[derive(Default)]
pub(crate) struct Streams(Mutex<HashMap<Uuid, mpsc::Sender<Bytes>>>);

impl Streams {
    pub(super) async fn receive(&self, bytes: Bytes) {
        if bytes.len() < 24 || bytes.len() > MAX_RECORD_BYTES || &bytes[..4] != b"RAS1" {
            return;
        }
        let Ok(id) = Uuid::from_slice(&bytes[8..24]) else {
            return;
        };
        let sender = self.0.lock().await.get(&id).cloned();
        if let Some(sender) = sender {
            // Awaiting a bounded consumer propagates disk backpressure into SCTP.
            if sender.send(bytes).await.is_err() {
                self.0.lock().await.remove(&id);
            }
        }
    }
    pub(super) async fn close(&self) {
        self.0.lock().await.clear();
    }
}

pub(crate) struct Port {
    peer: Arc<Peer>,
    channel: Arc<Channel>,
    id: Uuid,
    incoming: mpsc::Receiver<Bytes>,
}

impl State {
    pub(crate) async fn stream(&self, target: &Target, id: Uuid) -> Result<Port> {
        let peer = self.get("main", &target.peer).await?;
        let channel = peer.channel(&target.channel).await?;
        if channel.spec.label != "remote-ai-sync-v1" || channel.spec.negotiated != Some(43) {
            return Err(Error::Invalid);
        }
        let (sender, incoming) = mpsc::channel(QUEUED_RECORDS);
        let mut streams = peer.streams.0.lock().await;
        if streams.len() >= MAX_STREAMS || streams.contains_key(&id) {
            return Err(Error::Capacity);
        }
        streams.insert(id, sender);
        drop(streams);
        Ok(Port {
            peer,
            channel,
            id,
            incoming,
        })
    }
}

impl Port {
    #[cfg(test)]
    pub(crate) fn fixture_closer(&self) -> impl std::future::Future<Output = ()> + use<> {
        let peer = self.peer.clone();
        async move { peer.close().await }
    }
    #[cfg(test)]
    pub(crate) async fn close_fixture(self) {
        let peer = self.peer.clone();
        self.close().await;
        peer.close().await;
    }
    pub(crate) async fn send(&self, record: Bytes, cancelled: &AtomicBool) -> Result<()> {
        self.channel.send_file(record, cancelled).await
    }
    pub(crate) async fn receive(&mut self) -> Result<Bytes> {
        if self.peer.is_closed() {
            return Err(Error::Closed);
        }
        tokio::select! {
            record = self.incoming.recv() => record.ok_or(Error::Closed),
            _ = self.peer.stopped.notified() => Err(Error::Closed),
            _ = tokio::time::sleep(DEADLINE) => Err(Error::Transport),
        }
    }
    pub(crate) async fn close(self) {
        self.peer.streams.0.lock().await.remove(&self.id);
    }
}

#[cfg(test)]
pub(crate) async fn loopback_pair(id: Uuid) -> (Port, Port) {
    use webrtc::{
        api::setting_engine::SettingEngine, data_channel::data_channel_state::RTCDataChannelState,
    };
    async fn create() -> Arc<Peer> {
        let mut settings = SettingEngine::default();
        settings.set_include_loopback_candidate(true);
        settings.set_ip_filter(Box::new(|ip| ip.is_loopback()));
        settings.set_network_types(vec![webrtc::ice::network_type::NetworkType::Udp4]);
        Peer::configured(
            Configuration {
                ice_servers: vec![],
                relay_only: false,
                receive_media: false,
            },
            settings,
        )
        .await
        .unwrap()
    }
    let left = create().await;
    let right = create().await;
    let spec = ChannelSpec {
        key: Uuid::new_v4().to_string(),
        label: "remote-ai-sync-v1".into(),
        negotiated: Some(43),
    };
    left.create_channel(spec.clone()).await.unwrap();
    right.create_channel(spec.clone()).await.unwrap();
    let mut gathered = left.rtc.gathering_complete_promise().await;
    left.rtc
        .set_local_description(left.rtc.create_offer(None).await.unwrap())
        .await
        .unwrap();
    gathered.recv().await;
    right
        .rtc
        .set_remote_description(left.rtc.local_description().await.unwrap())
        .await
        .unwrap();
    let mut gathered = right.rtc.gathering_complete_promise().await;
    right
        .rtc
        .set_local_description(right.rtc.create_answer(None).await.unwrap())
        .await
        .unwrap();
    gathered.recv().await;
    left.rtc
        .set_remote_description(right.rtc.local_description().await.unwrap())
        .await
        .unwrap();
    async fn port(peer: Arc<Peer>, key: &str, id: Uuid) -> Port {
        let channel = peer.channel(key).await.unwrap();
        tokio::time::timeout(Duration::from_secs(10), async {
            while channel.rtc.ready_state() != RTCDataChannelState::Open {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let (sender, incoming) = mpsc::channel(QUEUED_RECORDS);
        peer.streams.0.lock().await.insert(id, sender);
        Port {
            peer,
            channel,
            id,
            incoming,
        }
    }
    (
        port(left, &spec.key, id).await,
        port(right, &spec.key, id).await,
    )
}
