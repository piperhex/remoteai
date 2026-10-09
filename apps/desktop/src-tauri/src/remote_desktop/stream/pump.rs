use super::super::{DesktopError, DesktopInput, Result};
use super::{encoder::Encoder, model::StreamStats, native::Stream};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::mpsc;

struct Progress {
    started: Instant,
    frames: u32,
    bytes: usize,
    rate: super::rate_control::RateController,
}

impl Progress {
    fn reset(&mut self) {
        self.started = Instant::now();
        self.frames = 0;
        self.bytes = 0;
    }
}

pub(super) async fn run(stream: Arc<Stream>, path: PathBuf, mut encoder: Encoder) {
    let result = video(&stream, path, &mut encoder).await;
    if let Err(error) = result {
        eprintln!("desktop video stopped: {error}");
    }
    encoder.stop().await;
    stream.close().await;
    let id = stream.id.clone();
    match tauri::async_runtime::spawn_blocking(move || super::super::close(&id)).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => eprintln!("desktop input cleanup: {error}"),
        Err(error) => eprintln!("desktop input cleanup worker: {error}"),
    }
}

pub(super) async fn wait_connected(stream: &Stream) -> Result<()> {
    let mut connected = stream.connected.subscribe();
    let mut cancel = stream.cancel.subscribe();
    let mut lease = tokio::time::interval(Duration::from_secs(2));
    let timeout = tokio::time::sleep(Duration::from_secs(25));
    tokio::pin!(timeout);
    while !*connected.borrow() {
        if *cancel.borrow() {
            return Err(DesktopError::Expired);
        }
        tokio::select! {
            _ = connected.changed() => {},
            _ = cancel.changed() => return Err(DesktopError::Expired),
            _ = &mut timeout => return Err(DesktopError::Expired),
            _ = lease.tick() => stream.keep_alive().await?,
        }
    }
    stream.heartbeat.send_replace(Instant::now());
    Ok(())
}

async fn video(stream: &Arc<Stream>, path: PathBuf, encoder: &mut Encoder) -> Result<()> {
    // ICE negotiation can take seconds. Discard the probe process so it cannot build a stale frame backlog.
    encoder.stop().await;
    wait_connected(stream).await?;
    let mut cancel = stream.cancel.subscribe();
    let mut settings = stream.profile.subscribe();
    let mut peers = stream.peer.subscribe();
    let mut feedback = peers.borrow().feedback.clone();
    let mut keyframe_version = 0;
    let mut keyframe_at = Instant::now() - Duration::from_secs(1);
    let mut interval = tokio::time::interval(Duration::from_secs(2));
    interval.tick().await;
    let mut progress = Progress {
        started: Instant::now(),
        frames: 0,
        bytes: 0,
        rate: super::rate_control::RateController::new(*settings.borrow()),
    };
    let profile = *settings.borrow();
    reconfigure(stream, &path, encoder, profile).await?;
    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        tokio::select! {
            _ = cancel.changed() => return Ok(()),
            _ = peers.changed() => {
                feedback = peers.borrow_and_update().feedback.clone();
                keyframe_version = 0;
                encoder.request_keyframe().await?;
            },
            changed = feedback.changed() => {
                if changed.is_err() {
                    let failed = Arc::clone(&peers.borrow());
                    if !peers.has_changed().unwrap_or(false)
                        && !super::relay::recover(stream, &failed).await { return Err(DesktopError::Platform); }
                    feedback = peers.borrow_and_update().feedback.clone();
                    continue;
                }
                let requested = feedback.borrow_and_update().keyframes;
                if requested != keyframe_version && keyframe_at.elapsed() >= Duration::from_millis(250) {
                    if let Err(error) = encoder.request_keyframe().await {
                        if !super::capture_recovery::desktop_switch_recovery() { return Err(error); }
                        // The helper may have exited during a desktop switch; stdout recovery reopens it below.
                    }
                    keyframe_version = requested; keyframe_at = Instant::now();
                }
            },
            _ = settings.changed() => {
                let profile = *settings.borrow_and_update();
                reconfigure(stream, &path, encoder, profile).await?;
                progress.rate = super::rate_control::RateController::new(profile);
                progress.reset();
            },
            frame = encoder.next() => {
                let frame = match frame {
                    Ok(frame) => frame,
                    Err(error) if super::capture_recovery::desktop_switch_recovery() => {
                        eprintln!("desktop capture restarting: {error}");
                        let profile = *settings.borrow();
                        super::capture_recovery::reopen(stream, &path, encoder, profile).await?
                    },
                    Err(error) => return Err(error),
                };
                progress.bytes += frame.len();
                send_frame(stream, frame).await?; progress.frames += 1;
            },
            _ = interval.tick() => {
                monitor(stream, &path, encoder, &mut progress).await?;
            },
        }
    }
}

async fn reconfigure(
    stream: &Stream,
    path: &std::path::Path,
    encoder: &mut Encoder,
    profile: super::model::Profile,
) -> Result<()> {
    match encoder.update(profile).await {
        Ok(true) => return Ok(()),
        Err(error) if !super::capture_recovery::desktop_switch_recovery() => return Err(error),
        _ => {}
    }
    encoder.stop().await;
    let opened = Encoder::open(path, profile, &stream.display).await;
    let (next, first) = match opened {
        Ok(opened) => opened,
        Err(_) if super::capture_recovery::desktop_switch_recovery() => {
            let first = super::capture_recovery::reopen(stream, path, encoder, profile).await?;
            return send_frame(stream, first).await;
        }
        Err(error) => return Err(error),
    };
    *encoder = next;
    send_frame(stream, first).await
}

async fn monitor(
    stream: &Stream,
    path: &std::path::Path,
    encoder: &mut Encoder,
    progress: &mut Progress,
) -> Result<()> {
    stream.keep_alive().await?;
    report(stream, encoder, progress.frames, progress.started).await?;
    let bitrate = (progress.bytes as f64 * 8.0 / progress.started.elapsed().as_secs_f64()) as u32;
    let feedback = *stream.peer.borrow().feedback.borrow();
    if let Some(profile) = progress.rate.sample(feedback, bitrate) {
        reconfigure(stream, path, encoder, profile).await?;
    }
    progress.reset();
    Ok(())
}

async fn send_frame(stream: &Stream, data: Vec<u8>) -> Result<()> {
    let duration = {
        let mut previous = stream.last_frame.lock().await;
        let now = Instant::now();
        let elapsed = now.duration_since(*previous);
        *previous = now;
        elapsed
    };
    // A slow sender must not build an unbounded queue of stale desktop frames.
    let active = Arc::clone(&stream.peer.borrow());
    let result = tokio::time::timeout(
        Duration::from_millis(250),
        super::direct::write(stream, data, duration, false),
    )
    .await
    .map_err(|_| DesktopError::Platform)
    .and_then(|result| result);
    if result.is_err() && super::relay::recover(stream, &active).await {
        return Ok(());
    }
    result
}

async fn report(stream: &Stream, encoder: &Encoder, frames: u32, started: Instant) -> Result<()> {
    use super::model::Connection;
    use webrtc::ice_transport::ice_candidate_type::RTCIceCandidateType;
    let peer = Arc::clone(&stream.peer.borrow());
    let connection = peer
        .connection
        .sctp()
        .transport()
        .ice_transport()
        .get_selected_candidate_pair()
        .await
        .map(|pair| {
            if [pair.local.typ, pair.remote.typ].contains(&RTCIceCandidateType::Relay) {
                Connection::Relay
            } else {
                Connection::Direct
            }
        });
    let audio = Some(*stream.audio.lock().await);
    let stats = {
        let mut current = stream.stats.lock().await;
        let stats = StreamStats {
            encoder: encoder.info(),
            fps: (f64::from(frames) / started.elapsed().as_secs_f64()).round(),
            width: encoder.width,
            height: encoder.height,
            bitrate: encoder.bitrate,
            closed: false,
            connection,
            audio,
            ice: peer.ice.lock().await.clone(),
        };
        *current = stats.clone();
        stats
    };
    let mut message = serde_json::to_value(&stats).map_err(|_| DesktopError::Platform)?;
    message["kind"] = "stats".into();
    let sent = peer.controls.send_text(message.to_string()).await;
    if Arc::ptr_eq(&stream.peer.borrow(), &peer)
        && !(sent.is_err() && super::relay::recover(stream, &peer).await)
    {
        sent.map_err(|_| DesktopError::Platform)?;
    }
    Ok(())
}

pub(super) async fn inputs(
    stream: Arc<Stream>,
    mut inputs: mpsc::Receiver<bytes::Bytes>,
    clipboard: bool,
) {
    let mut cancel = stream.cancel.subscribe();
    loop {
        if *cancel.borrow() {
            return;
        }
        let message = tokio::select! {
            _ = cancel.changed() => return,
            message = inputs.recv() => { let Some(message) = message else { return; }; message },
        };
        let id = stream.id.clone();
        let result = tauri::async_runtime::spawn_blocking(move || apply_input(&id, &message)).await;
        let reply = match result {
            Ok(Ok(reply)) => reply,
            Ok(Err(DesktopError::Platform))
                if super::capture_recovery::desktop_switch_recovery() =>
            {
                // Windows may reject input while switching desktops. Do not replay a partially applied
                // keystroke; keep video/authorization alive so the next input can use the new desktop.
                continue;
            }
            _ => {
                stream.cancel.send_replace(true);
                return;
            }
        };
        if let Some(reply) = reply {
            let peer = Arc::clone(&stream.peer.borrow());
            let channel = if clipboard {
                &peer.clipboard
            } else {
                &peer.controls
            };
            if channel.send_text(reply).await.is_err()
                && Arc::ptr_eq(&stream.peer.borrow(), &peer)
                && !super::relay::recover(&stream, &peer).await
            {
                stream.cancel.send_replace(true);
                return;
            }
        }
    }
}

fn apply_input(id: &str, data: &[u8]) -> Result<Option<String>> {
    let value: serde_json::Value =
        serde_json::from_slice(data).map_err(|_| DesktopError::Invalid)?;
    if value.get("kind").and_then(serde_json::Value::as_str) == Some("clipboard") {
        let message = serde_json::from_value(value).map_err(|_| DesktopError::Invalid)?;
        let reply = super::super::clipboard::handle(id, message);
        return serde_json::to_string(&reply)
            .map(Some)
            .map_err(|_| DesktopError::Platform);
    }
    let input: DesktopInput = serde_json::from_value(value).map_err(|_| DesktopError::Invalid)?;
    super::super::validation::input(&input)?;
    super::super::with_session(id, |session| {
        if !session.permissions.control {
            return Err(DesktopError::Denied);
        }
        session.input.apply(input, &session.display)
    })
    .map(|()| None)
}
