//! Prepare a separate direct peer while the active peer continues carrying media and input.
use super::super::{DesktopError, Result};
use super::{
    model::*,
    native::Stream,
    peer::{self, Peer},
};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;

const PROBE_LIFETIME: Duration = Duration::from_secs(35);
const MIN_RETRY: Duration = Duration::from_secs(5);
const MAX_GENERATION: u32 = 1_000_000;

#[cfg(test)]
#[path = "direct_tests.rs"]
mod tests;

#[derive(Default)]
pub(super) struct Upgrades {
    generation: u32,
    pending: Option<Arc<Peer>>,
    retiring: Option<Arc<Peer>>,
    committed: bool,
    creating: bool,
    cancelled: bool,
    started: Option<Instant>,
}

pub(super) async fn signal(
    stream: &Arc<Stream>,
    upgrade: DirectUpgrade,
    request: SignalRequest,
) -> Result<SignalReply> {
    if upgrade.generation == 0 || upgrade.generation > MAX_GENERATION {
        return Err(DesktopError::Invalid);
    }
    match upgrade.action {
        UpgradeAction::Start => start(stream, upgrade.generation).await,
        UpgradeAction::Commit => commit(stream, upgrade.generation).await,
        UpgradeAction::Cancel => {
            cancel(stream, upgrade.generation).await;
            Ok(SignalReply::default())
        }
        UpgradeAction::Signal => {
            let peer = {
                let state = stream.upgrades.lock().await;
                if state.generation != upgrade.generation {
                    return Err(DesktopError::Invalid);
                }
                state.pending.clone().ok_or(DesktopError::Expired)?
            };
            peer.signal(request).await
        }
    }
}

fn reserve(state: &mut Upgrades, generation: u32) -> Result<()> {
    if generation <= state.generation
        || state.creating
        || state.pending.is_some()
        || state.retiring.is_some()
        || state.started.is_some_and(|time| time.elapsed() < MIN_RETRY)
    {
        return Err(DesktopError::Invalid);
    }
    state.generation = generation;
    state.started = Some(Instant::now());
    state.committed = false;
    state.creating = true;
    state.cancelled = false;
    Ok(())
}

fn direct_servers(servers: &[IceServer]) -> Vec<IceServer> {
    // Reuse local native adapters; probes need neither public TURN nor a second capture/encoder.
    servers
        .iter()
        .filter_map(|server| {
            if server.native_media {
                return Some(server.clone());
            }
            let urls: Vec<_> = server
                .urls
                .iter()
                .filter(|url| url.starts_with("stun:") || url.starts_with("stuns:"))
                .cloned()
                .collect();
            (!urls.is_empty()).then_some(IceServer {
                urls,
                username: String::new(),
                credential: String::new(),
                ..Default::default()
            })
        })
        .collect()
}

async fn prepare(stream: &Arc<Stream>) -> Result<(Arc<Peer>, Offer)> {
    let codec = stream.profile.borrow().codec;
    let peer = Arc::new(
        Box::pin(peer::create_codec(
            direct_servers(&stream.ice_servers),
            stream.separate_clipboard,
            codec,
        ))
        .await?,
    );
    peer::bind(stream, &peer);
    match peer.offer().await {
        Ok(offer) => Ok((peer, offer)),
        Err(error) => {
            peer.close().await;
            Err(error)
        }
    }
}

async fn start(stream: &Arc<Stream>, generation: u32) -> Result<SignalReply> {
    stream.keep_alive().await?;
    reserve(&mut *stream.upgrades.lock().await, generation)?;
    let prepared = prepare(stream).await;
    let mut state = stream.upgrades.lock().await;
    state.creating = false;
    let (peer, offer) = prepared?;
    if *stream.cancel.borrow() || state.generation != generation || state.cancelled {
        drop(state);
        peer.close().await;
        return Err(DesktopError::Expired);
    }
    state.pending = Some(peer);
    drop(state);
    expire(stream, generation);
    Ok(SignalReply {
        sdp: Some(offer.sdp),
        generation: Some(generation),
        ..Default::default()
    })
}

fn expire(stream: &Arc<Stream>, generation: u32) {
    let weak = Arc::downgrade(stream);
    let mut cancelled = stream.cancel.subscribe();
    tokio::spawn(async move {
        if *cancelled.borrow() {
            return;
        }
        tokio::select! {
            _ = cancelled.changed() => return,
            _ = tokio::time::sleep(PROBE_LIFETIME) => {},
        }
        if let Some(stream) = weak.upgrade() {
            cancel(&stream, generation).await;
        }
    });
}

async fn commit(stream: &Stream, generation: u32) -> Result<SignalReply> {
    let mut state = stream.upgrades.lock().await;
    if state.generation != generation {
        return Err(DesktopError::Invalid);
    }
    if !state.committed {
        let Some(peer) = state.pending.as_ref() else {
            return Ok(SignalReply {
                generation: Some(generation),
                committed: Some(false),
                ..Default::default()
            });
        };
        if peer.connection.connection_state() != RTCPeerConnectionState::Connected
            || !peer.direct().await
        {
            return Ok(SignalReply {
                generation: Some(generation),
                committed: Some(false),
                ..Default::default()
            });
        }
        if *stream.cancel.borrow() {
            return Err(DesktopError::Expired);
        }
        let peer = state.pending.take().ok_or(DesktopError::Expired)?;
        state.retiring = Some(stream.peer.send_replace(peer));
        state.committed = true;
    }
    // Keep the old peer until a ping arrives on the promoted channel, including when this reply is lost.
    Ok(SignalReply {
        generation: Some(generation),
        committed: Some(true),
        ..Default::default()
    })
}

async fn cancel(stream: &Stream, generation: u32) {
    let peer = {
        let mut state = stream.upgrades.lock().await;
        if state.generation != generation || state.committed {
            return;
        }
        state.cancelled = true;
        state.pending.take()
    };
    if let Some(peer) = peer {
        peer.close().await;
    }
}

pub(super) async fn is_retiring(stream: &Stream, peer: &Arc<Peer>) -> bool {
    stream
        .upgrades
        .lock()
        .await
        .retiring
        .as_ref()
        .is_some_and(|old| Arc::ptr_eq(old, peer))
}

pub(super) async fn fallback(stream: &Stream) {
    let mut state = stream.upgrades.lock().await;
    if state.pending.is_none() {
        state.committed = false;
    }
}

pub(super) async fn retire(stream: &Stream) {
    let peer = stream.upgrades.lock().await.retiring.take();
    if let Some(peer) = peer {
        if stream.relay_standby && !*stream.cancel.borrow() && !peer.direct().await {
            super::relay::retain(stream, peer).await;
        } else {
            peer.close().await;
        }
    }
}

pub(super) async fn close(stream: &Stream) {
    let pending = stream.upgrades.lock().await.pending.take();
    if let Some(peer) = pending {
        peer.close().await;
    }
    retire(stream).await;
}

pub(super) async fn auxiliary(stream: &Stream) -> Option<Arc<Peer>> {
    let state = stream.upgrades.lock().await;
    state
        .pending
        .as_ref()
        .or(state.retiring.as_ref())
        .filter(|peer| peer.connection.connection_state() == RTCPeerConnectionState::Connected)
        .cloned()
}

/// Warm the direct decoder using the existing encoded frames; a slow probe cannot fail the active stream.
pub(super) async fn write(
    stream: &Stream,
    data: Vec<u8>,
    elapsed: Duration,
    audio: bool,
) -> Result<()> {
    let active = Arc::clone(&stream.peer.borrow());
    let auxiliary = auxiliary(stream).await;
    let active_track = if audio { &active.audio } else { &active.video };
    let Some(auxiliary) = auxiliary else {
        let result = super::sample::write_frame(active_track, data, elapsed).await;
        return write_result(stream, &active, result).await;
    };
    let extra = data.clone();
    let (result, ()) = tokio::join!(
        super::sample::write_frame(active_track, data, elapsed),
        async {
            let peer = auxiliary;
            let track = if audio { &peer.audio } else { &peer.video };
            // Losing a warm-up frame is intentional; the visible stream has its own delivery result.
            if let Ok(Err(error)) = tokio::time::timeout(
                Duration::from_millis(20),
                super::sample::write_frame(track, extra, elapsed),
            )
            .await
            {
                eprintln!("desktop direct warm-up frame: {error}");
            }
        }
    );
    // A promotion can retire the peer while its final write is still in flight.
    write_result(stream, &active, result).await
}

async fn write_result(stream: &Stream, peer: &Arc<Peer>, result: Result<()>) -> Result<()> {
    if !Arc::ptr_eq(&stream.peer.borrow(), peer)
        || (result.is_err() && super::relay::recover(stream, peer).await)
    {
        return Ok(());
    }
    result
}
