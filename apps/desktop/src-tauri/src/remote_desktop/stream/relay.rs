//! A persistent TURN peer carries heartbeats while the active direct peer carries media.
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
use webrtc::{
    data_channel::data_channel_state::RTCDataChannelState,
    peer_connection::peer_connection_state::RTCPeerConnectionState,
};

const PROBE_LIFETIME: Duration = Duration::from_secs(35);
const MIN_RETRY: Duration = Duration::from_secs(5);
const STANDBY_PING: &[u8] = br#"{"kind":"standby-ping"}"#;
const STANDBY_PONG: &str = r#"{"kind":"standby-pong"}"#;
const STANDBY_ACTIVATE: &[u8] = br#"{"kind":"standby-activate"}"#;
const STANDBY_ACTIVE: &str = r#"{"kind":"standby-active"}"#;

#[derive(Default)]
pub(super) struct Standby {
    generation: u32,
    pending: Option<Arc<Peer>>,
    ready: Option<Arc<Peer>>,
    started: Option<Instant>,
    creating: bool,
    cancelled: bool,
    committed: bool,
}

pub(super) fn servers(servers: &[IceServer]) -> Vec<IceServer> {
    servers
        .iter()
        .filter(|server| !server.native_media)
        .filter_map(|server| {
            let urls: Vec<_> = server
                .urls
                .iter()
                .filter(|url| url.starts_with("turn:") || url.starts_with("turns:"))
                .cloned()
                .collect();
            (!urls.is_empty()).then(|| IceServer {
                urls,
                ..server.clone()
            })
        })
        .collect()
}

pub(super) async fn signal(
    stream: &Arc<Stream>,
    request: DirectUpgrade,
    signal: SignalRequest,
) -> Result<SignalReply> {
    if request.generation == 0 || request.generation > 1_000_000 {
        return Err(DesktopError::Invalid);
    }
    if matches!(request.action, UpgradeAction::Start) {
        return start(stream, request.generation).await;
    }
    let pending = {
        let state = stream.standby.lock().await;
        if state.generation != request.generation {
            return Err(DesktopError::Invalid);
        }
        state.pending.clone()
    };
    match request.action {
        UpgradeAction::Signal => pending.ok_or(DesktopError::Expired)?.signal(signal).await,
        UpgradeAction::Commit => commit(stream, request.generation).await,
        UpgradeAction::Cancel => {
            cancel(stream, request.generation).await;
            Ok(SignalReply::default())
        }
        UpgradeAction::Start => Err(DesktopError::Invalid),
    }
}

async fn start(stream: &Arc<Stream>, generation: u32) -> Result<SignalReply> {
    stream.keep_alive().await?;
    let servers = servers(&stream.ice_servers);
    if servers.is_empty() {
        return Err(DesktopError::Invalid);
    }
    {
        let mut state = stream.standby.lock().await;
        if generation <= state.generation
            || state.creating
            || state.pending.is_some()
            || state.started.is_some_and(|at| at.elapsed() < MIN_RETRY)
        {
            return Err(DesktopError::Invalid);
        }
        state.generation = generation;
        state.creating = true;
        state.cancelled = false;
        state.committed = false;
        state.started = Some(Instant::now());
    }
    let result = prepare(stream, servers).await;
    let mut state = stream.standby.lock().await;
    state.creating = false;
    let (peer, offer) = result?;
    if *stream.cancel.borrow() || state.cancelled {
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

async fn prepare(stream: &Arc<Stream>, servers: Vec<IceServer>) -> Result<(Arc<Peer>, Offer)> {
    let codec = stream.profile.borrow().codec;
    let peer = Arc::new(
        Box::pin(peer::create_with_policy(
            servers,
            stream.separate_clipboard,
            true,
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
    let mut state = stream.standby.lock().await;
    if state.generation != generation || state.cancelled || *stream.cancel.borrow() {
        return Err(DesktopError::Expired);
    }
    let mut old = None;
    if !state.committed {
        if let Some(peer) = state.pending.as_ref().filter(|peer| usable(peer)) {
            if peer.direct().await {
                return Err(DesktopError::Invalid);
            }
            let peer = state.pending.take().ok_or(DesktopError::Expired)?;
            old = state.ready.replace(peer);
            state.committed = true;
        }
    }
    let committed = state.committed;
    drop(state);
    close_inactive(stream, old).await;
    Ok(SignalReply {
        generation: Some(generation),
        committed: Some(committed),
        ..Default::default()
    })
}

pub(super) async fn retain(stream: &Stream, peer: Arc<Peer>) {
    let (old, pending) = {
        let mut state = stream.standby.lock().await;
        // A retained relay supersedes any backup offer still being created or exchanged.
        state.cancelled = true;
        state.committed = false;
        (state.ready.replace(peer), state.pending.take())
    };
    close_inactive(stream, pending).await;
    close_inactive(stream, old).await;
}

async fn close_inactive(stream: &Stream, peer: Option<Arc<Peer>>) {
    if let Some(peer) = peer {
        let ready = stream.standby.lock().await.ready.clone();
        if !Arc::ptr_eq(&stream.peer.borrow(), &peer)
            && !ready.is_some_and(|ready| Arc::ptr_eq(&ready, &peer))
        {
            peer.close().await;
        }
    }
}

fn usable(peer: &Peer) -> bool {
    peer.connection.connection_state() == RTCPeerConnectionState::Connected
        && peer.controls.ready_state() == RTCDataChannelState::Open
}

/// A failed active peer must not end capture while a healthy relay can take over.
pub(super) async fn recover(stream: &Stream, failed: &Arc<Peer>) -> bool {
    if !stream.relay_standby || *stream.cancel.borrow() {
        return false;
    }
    if !Arc::ptr_eq(&stream.peer.borrow(), failed) {
        return true;
    }
    super::direct::retire(stream).await;
    let ready = stream.standby.lock().await.ready.clone();
    let Some(peer) = ready.filter(|peer| !Arc::ptr_eq(peer, failed) && usable(peer)) else {
        return false;
    };
    activate(stream, &peer).await
}

async fn activate(stream: &Stream, peer: &Arc<Peer>) -> bool {
    let state = stream.standby.lock().await;
    if *stream.cancel.borrow()
        || !usable(peer)
        || !state
            .ready
            .as_ref()
            .is_some_and(|ready| Arc::ptr_eq(ready, peer))
    {
        return false;
    }
    let old = if Arc::ptr_eq(&stream.peer.borrow(), peer) {
        None
    } else {
        Some(stream.peer.send_replace(Arc::clone(peer)))
    };
    drop(state);
    super::direct::fallback(stream).await;
    stream.heartbeat.send_replace(Instant::now());
    if let Some(old) = old {
        old.close().await;
    }
    match peer.controls.send_text(STANDBY_ACTIVE).await {
        Ok(_) => true,
        Err(error) => {
            eprintln!("desktop relay activation reply: {error}");
            false
        }
    }
}

/// Consume standby controls during promotion, but only a retained peer can renew or activate.
pub(super) async fn receive(stream: &Stream, peer: &Arc<Peer>, data: &[u8]) -> bool {
    if ![STANDBY_PING, STANDBY_ACTIVATE].contains(&data) {
        return false;
    }
    if !stream.relay_standby || *stream.cancel.borrow() {
        return true;
    }
    let matches = stream
        .standby
        .lock()
        .await
        .ready
        .as_ref()
        .is_some_and(|ready| Arc::ptr_eq(ready, peer));
    if !matches {
        // The old relay can receive this before the new direct peer's ping registers it.
        // It must never reach input parsing. The viewer retries after registration.
        return true;
    }
    stream.heartbeat.send_replace(Instant::now());
    if data == STANDBY_ACTIVATE {
        activate(stream, peer).await;
    } else if let Err(error) = peer.controls.send_text(STANDBY_PONG).await {
        eprintln!("desktop relay heartbeat: {error}");
    }
    true
}

async fn cancel(stream: &Stream, generation: u32) {
    let pending = {
        let mut state = stream.standby.lock().await;
        if state.generation != generation || state.committed {
            return;
        }
        state.cancelled = true;
        state.pending.take()
    };
    if let Some(peer) = pending {
        peer.close().await;
    }
}

pub(super) async fn close(stream: &Stream) {
    let (pending, ready) = {
        let mut state = stream.standby.lock().await;
        state.cancelled = true;
        (state.pending.take(), state.ready.take())
    };
    for peer in [pending, ready].into_iter().flatten() {
        peer.close().await;
    }
}
