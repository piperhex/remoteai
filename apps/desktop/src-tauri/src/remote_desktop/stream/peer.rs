use super::super::{DesktopError, Result};
use super::{codec::VideoCodec, model::IceServer, native::Stream};
use std::sync::{Arc, Weak};
use webrtc::{
    api::{
        interceptor_registry::register_default_interceptors, media_engine::MediaEngine, APIBuilder,
    },
    data_channel::{data_channel_message::DataChannelMessage, RTCDataChannel},
    ice_transport::ice_server::RTCIceServer,
    interceptor::registry::Registry,
    peer_connection::{
        configuration::RTCConfiguration, peer_connection_state::RTCPeerConnectionState,
        RTCPeerConnection,
    },
    rtp_transceiver::rtp_codec::RTCRtpCodecCapability,
    track::track_local::{track_local_static_sample::TrackLocalStaticSample, TrackLocal},
};

pub(super) struct Peer {
    pub native_media: Option<(String, String)>,
    pub connection: Arc<RTCPeerConnection>,
    pub controls: Arc<RTCDataChannel>,
    pub clipboard: Arc<RTCDataChannel>,
    pub video: Arc<TrackLocalStaticSample>,
    pub audio: Arc<TrackLocalStaticSample>,
    pub feedback: tokio::sync::watch::Receiver<super::feedback::Feedback>,
    pub transports: super::turn_transport::Transports,
    pub candidates: tokio::sync::Mutex<Vec<serde_json::Value>>,
    pub ice: tokio::sync::Mutex<super::model::IceDiagnostics>,
    pub signaling: tokio::sync::Mutex<()>,
}

#[cfg(test)]
pub(super) async fn create(servers: Vec<IceServer>, separate_clipboard: bool) -> Result<Peer> {
    create_codec(servers, separate_clipboard, VideoCodec::H264).await
}

pub(super) async fn create_codec(
    servers: Vec<IceServer>,
    separate_clipboard: bool,
    codec: VideoCodec,
) -> Result<Peer> {
    create_with_policy(servers, separate_clipboard, false, codec).await
}

pub(super) async fn create_with_policy(
    mut servers: Vec<IceServer>,
    separate_clipboard: bool,
    relay_only: bool,
    codec: VideoCodec,
) -> Result<Peer> {
    let native_media = servers
        .iter()
        .find(|server| server.native_media)
        .map(|server| (server.local_address.clone(), server.remote_address.clone()));
    let transports = super::turn_transport::prepare(&mut servers).await?;
    let mut media = MediaEngine::default();
    media
        .register_default_codecs()
        .map_err(|_| DesktopError::Platform)?;
    let registry = register_default_interceptors(Registry::new(), &mut media)
        .map_err(|_| DesktopError::Platform)?;
    let api = APIBuilder::new()
        .with_media_engine(media)
        .with_interceptor_registry(registry)
        .build();
    let configuration = RTCConfiguration {
        ice_transport_policy: if relay_only {
            webrtc::peer_connection::policy::ice_transport_policy::RTCIceTransportPolicy::Relay
        } else {
            webrtc::peer_connection::policy::ice_transport_policy::RTCIceTransportPolicy::All
        },
        ice_servers: servers
            .into_iter()
            .map(|server| RTCIceServer {
                urls: server.urls,
                username: server.username,
                credential: server.credential,
            })
            .collect(),
        ..Default::default()
    };
    #[cfg(test)]
    let configuration = RTCConfiguration {
        ice_transport_policy: if relay_only
            || std::env::var_os("CSW_NATIVE_TEST_ICE").is_some()
                && configuration.ice_servers.iter().any(|server| {
                    server
                        .urls
                        .iter()
                        .any(|url| url.starts_with("turn:") || url.starts_with("turns:"))
                }) {
            webrtc::peer_connection::policy::ice_transport_policy::RTCIceTransportPolicy::Relay
        } else {
            webrtc::peer_connection::policy::ice_transport_policy::RTCIceTransportPolicy::All
        },
        ..configuration
    };
    let connection = Arc::new(
        api.new_peer_connection(configuration)
            .await
            .map_err(|_| DesktopError::Platform)?,
    );
    let video = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: codec.mime().into(),
            clock_rate: super::sample::VIDEO_CLOCK_RATE,
            sdp_fmtp_line: codec.fmtp().into(),
            ..Default::default()
        },
        "desktop-video".into(),
        "desktop".into(),
    ));
    let sender = connection
        .add_track(Arc::clone(&video) as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|_| DesktopError::Platform)?;
    configure_video_codec(&connection, &sender, codec).await?;
    // Reading RTCP drives the default NACK/report interceptors. Periodic IDRs also bound recovery time.
    let feedback = super::feedback::listen(sender);
    let audio = super::audio::track(&connection).await?;
    let controls = connection
        .create_data_channel("remote-desktop-controls", None)
        .await
        .map_err(|_| DesktopError::Platform)?;
    let clipboard = if separate_clipboard {
        connection
            .create_data_channel("remote-desktop-clipboard", None)
            .await
            .map_err(|_| DesktopError::Platform)?
    } else {
        Arc::clone(&controls)
    };
    Ok(Peer {
        native_media,
        connection,
        controls,
        clipboard,
        video,
        audio,
        feedback,
        transports,
        candidates: tokio::sync::Mutex::new(Vec::new()),
        ice: tokio::sync::Mutex::new(super::model::IceDiagnostics::default()),
        signaling: tokio::sync::Mutex::new(()),
    })
}

async fn configure_video_codec(
    connection: &RTCPeerConnection,
    sender: &Arc<webrtc::rtp_transceiver::rtp_sender::RTCRtpSender>,
    codec: VideoCodec,
) -> Result<()> {
    let mut codecs = sender.get_parameters().await.rtp_parameters.codecs;
    codecs.retain(|candidate| {
        candidate
            .capability
            .mime_type
            .eq_ignore_ascii_case(codec.mime())
    });
    codecs.truncate(1);
    for candidate in &mut codecs {
        candidate.capability.sdp_fmtp_line = codec.fmtp().into();
    }
    for transceiver in connection.get_transceivers().await {
        if Arc::ptr_eq(&transceiver.sender().await, sender) {
            return transceiver
                .set_codec_preferences(codecs)
                .await
                .map_err(|_| DesktopError::Platform);
        }
    }
    Err(DesktopError::Platform)
}

pub(super) fn bind(stream: &Arc<Stream>, peer: &Arc<Peer>) {
    bind_candidates(peer);
    bind_state(stream, peer);
    bind_channel(stream, peer, false);
    if !Arc::ptr_eq(&peer.clipboard, &peer.controls) {
        bind_channel(stream, peer, true);
    }
}

fn bind_candidates(peer: &Arc<Peer>) {
    let weak = Arc::downgrade(peer);
    peer.connection.on_ice_candidate(Box::new(move |candidate| {
        let weak = weak.clone();
        Box::pin(async move {
            let (Some(peer), Some(candidate)) = (weak.upgrade(), candidate) else {
                return;
            };
            let candidate = candidate
                .to_json()
                .ok()
                .and_then(|value| serde_json::to_value(value).ok());
            let Some(candidate) = candidate else {
                // Candidate serialization failure leaves other gathered paths available.
                eprintln!("desktop candidate serialization failed");
                return;
            };
            peer.ice.lock().await.local_candidates += 1;
            let mut pending = peer.candidates.lock().await;
            if pending.len() < super::MAX_CANDIDATES {
                pending.push(candidate);
            }
        })
    }));
}

fn bind_state(stream: &Arc<Stream>, peer: &Arc<Peer>) {
    let weak = Arc::downgrade(stream);
    let peer_weak = Arc::downgrade(peer);
    peer.connection
        .on_peer_connection_state_change(Box::new(move |state| {
            let (weak, peer_weak) = (weak.clone(), peer_weak.clone());
            Box::pin(async move {
                if let (Some(stream), Some(peer)) = (weak.upgrade(), peer_weak.upgrade()) {
                    peer.ice.lock().await.state = state.to_string();
                    if Arc::ptr_eq(&stream.peer.borrow(), &peer) {
                        stream.stats.lock().await.ice = peer.ice.lock().await.clone();
                        if matches!(
                            state,
                            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed
                        ) && !super::relay::recover(&stream, &peer).await
                        {
                            stream.cancel.send_replace(true);
                        }
                    }
                }
            })
        }));
}

fn bind_channel(stream: &Arc<Stream>, peer: &Arc<Peer>, clipboard: bool) {
    let channel = if clipboard {
        &peer.clipboard
    } else {
        &peer.controls
    };
    let weak = Arc::downgrade(stream);
    let peer_weak = Arc::downgrade(peer);
    channel.on_message(Box::new(move |message| {
        let (weak, peer_weak) = (weak.clone(), peer_weak.clone());
        Box::pin(async move {
            receive(weak, peer_weak, message, clipboard).await;
        })
    }));
    if clipboard {
        return;
    }
    let weak = Arc::downgrade(stream);
    let peer_weak = Arc::downgrade(peer);
    channel.on_open(Box::new(move || {
        if let (Some(stream), Some(peer)) = (weak.upgrade(), peer_weak.upgrade()) {
            if Arc::ptr_eq(&stream.peer.borrow(), &peer) {
                stream.connected.send_replace(true);
            }
        }
        Box::pin(async {})
    }));
    let weak = Arc::downgrade(stream);
    let peer_weak = Arc::downgrade(peer);
    channel.on_close(Box::new(move || {
        let (weak, peer_weak) = (weak.clone(), peer_weak.clone());
        Box::pin(async move {
            if let (Some(stream), Some(peer)) = (weak.upgrade(), peer_weak.upgrade()) {
                if Arc::ptr_eq(&stream.peer.borrow(), &peer)
                    && !super::relay::recover(&stream, &peer).await
                {
                    stream.cancel.send_replace(true);
                }
            }
        })
    }));
}

async fn receive(
    weak: Weak<Stream>,
    peer: Weak<Peer>,
    message: DataChannelMessage,
    clipboard: bool,
) {
    let (Some(stream), Some(peer)) = (weak.upgrade(), peer.upgrade()) else {
        return;
    };
    if !clipboard && message.is_string && super::relay::receive(&stream, &peer, &message.data).await
    {
        return;
    }
    if !Arc::ptr_eq(&stream.peer.borrow(), &peer)
        && !super::direct::is_retiring(&stream, &peer).await
    {
        return;
    }
    if !message.is_string || message.data.len() > 64 * 1024 {
        stream.cancel.send_replace(true);
        return;
    }
    if message.data.as_ref() == br#"{"kind":"ping"}"# {
        stream.heartbeat.send_replace(std::time::Instant::now());
        if Arc::ptr_eq(&stream.peer.borrow(), &peer) {
            super::direct::retire(&stream).await;
            if stream.relay_standby {
                if let Err(error) = peer.controls.send_text(r#"{"kind":"pong"}"#).await {
                    eprintln!("desktop heartbeat reply: {error}");
                }
            }
        }
        return;
    }
    let inputs = if clipboard {
        &stream.clipboard_inputs
    } else {
        &stream.inputs
    };
    if inputs.try_send(message.data).is_err() {
        stream.cancel.send_replace(true);
    }
}
