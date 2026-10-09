use super::super::super::{DesktopError, Result};
use super::super::{
    audio_packet::{AudioPacket, MAX_BACKLOG},
    native::Stream,
    packets::Packets,
};
use std::{path::Path, process::Stdio, sync::Arc, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};
const RETRY_INTERVAL: Duration = Duration::from_secs(2);
const READ_TIMEOUT: Duration = Duration::from_secs(3);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub(in crate::remote_desktop::stream) async fn run(stream: Arc<Stream>, path: std::path::PathBuf) {
    let id = stream.id.clone();
    let allowed = tauri::async_runtime::spawn_blocking(move || {
        super::super::super::with_session(&id, |session| Ok(session.permissions.audio))
    })
    .await;
    if !matches!(allowed, Ok(Ok(true))) {
        *stream.audio.lock().await = super::super::model::AudioState::Unavailable;
        return;
    }
    if super::super::pump::wait_connected(&stream).await.is_err() {
        return;
    }
    let mut cancel = stream.cancel.subscribe();
    let mut previous = std::time::Instant::now();
    while !*cancel.borrow() {
        let result = tokio::select! {
            _ = cancel.changed() => return,
            result = capture(&stream, &path, &mut previous) => result,
        };
        if let Err(error) = result {
            eprintln!("desktop audio restarting: {error}");
        }
        *stream.audio.lock().await = super::super::model::AudioState::Unavailable;
        tokio::select! {
            _ = cancel.changed() => return,
            _ = tokio::time::sleep(RETRY_INTERVAL) => {},
        }
    }
}

fn spawn(path: &Path) -> Result<tokio::process::Child> {
    // Only the bundled helper is executable. Capture/encoding never runs on the UI thread.
    Command::new(path.with_file_name("desktop-video.exe"))
        .arg("audio")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|_| DesktopError::Platform)
}

async fn capture(stream: &Stream, path: &Path, previous: &mut std::time::Instant) -> Result<()> {
    let mut child = spawn(path)?;
    let mut output = child.stdout.take().ok_or(DesktopError::Platform)?;
    let mut packets = Packets::default();
    let mut previous_ticks = None;
    loop {
        let mut buffer = [0; 8192];
        let count = tokio::time::timeout(READ_TIMEOUT, output.read(&mut buffer))
            .await
            .map_err(|_| DesktopError::Platform)?
            .map_err(|_| DesktopError::Platform)?;
        if count == 0 {
            return Err(DesktopError::Platform);
        }
        packets.push(&buffer[..count])?;
        let mut ready = Vec::new();
        while let Some(packet) = packets.next()? {
            ready.push(AudioPacket::parse(packet)?);
        }
        let latest = ready.last().map_or(0, |packet| packet.ticks);
        for packet in ready {
            if latest.saturating_sub(packet.ticks) >= MAX_BACKLOG {
                continue;
            }
            let elapsed = match previous_ticks {
                Some(ticks) => packet.elapsed(ticks)?,
                None => previous.elapsed(),
            };
            previous_ticks = Some(packet.ticks);
            send(stream, packet.data, elapsed).await?;
            *previous = std::time::Instant::now();
        }
    }
}

async fn send(stream: &Stream, packet: Vec<u8>, elapsed: Duration) -> Result<()> {
    tokio::time::timeout(
        Duration::from_millis(250),
        super::super::direct::write(stream, packet, elapsed, true),
    )
    .await
    .map_err(|_| DesktopError::Platform)??;
    *stream.audio.lock().await = super::super::model::AudioState::Playing;
    Ok(())
}
