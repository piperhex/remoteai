use super::{channel::Channel, model::*, peer::Peer};
use std::sync::Arc;

pub(super) fn bind(peer: &Arc<Peer>) {
    let weak = Arc::downgrade(peer);
    peer.rtc.on_ice_candidate(Box::new(move |candidate| {
        let weak = weak.clone();
        Box::pin(async move {
            let (Some(peer), Some(candidate)) = (weak.upgrade(), candidate) else {
                return;
            };
            match candidate.to_json() {
                Ok(candidate) => peer.emit(Event::Candidate { candidate }),
                Err(_) => peer.stop(),
            }
        })
    }));
    let weak = Arc::downgrade(peer);
    peer.rtc
        .on_peer_connection_state_change(Box::new(move |state| {
            let weak = weak.clone();
            Box::pin(async move {
                if let Some(peer) = weak.upgrade() {
                    peer.emit(Event::State {
                        state: state.to_string(),
                    });
                }
            })
        }));
    let weak = Arc::downgrade(peer);
    peer.rtc
        .on_ice_gathering_state_change(Box::new(move |state| {
            let weak = weak.clone();
            Box::pin(async move {
                if let Some(peer) = weak.upgrade() {
                    peer.emit(Event::Gathering {
                        state: state.to_string(),
                        description: peer.rtc.local_description().await.map(|description| {
                            Description {
                                r#type: description.sdp_type.to_string(),
                                sdp: description.sdp,
                            }
                        }),
                    });
                }
            })
        }));
    bind_channels(peer);
}

fn bind_channels(peer: &Arc<Peer>) {
    let weak = Arc::downgrade(peer);
    peer.rtc.on_data_channel(Box::new(move |rtc| {
        let weak = weak.clone();
        Box::pin(async move {
            let Some(peer) = weak.upgrade() else {
                return;
            };
            let spec = ChannelSpec {
                key: uuid::Uuid::new_v4().to_string(),
                label: rtc.label().into(),
                negotiated: None,
            };
            let mut channels = peer.channels.lock().await;
            if spec.validate().is_err() || channels.len() >= MAX_CHANNELS {
                drop(channels);
                peer.stop();
                return;
            }
            let channel = Channel::bind(&peer, spec.clone(), rtc).await;
            channels.insert(spec.key.clone(), channel);
            peer.emit(Event::Channel { channel: spec });
        })
    }));
}
