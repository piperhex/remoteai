//! The bundled ScreenCaptureKit/VideoToolbox helper produces framed H.264 access units.
use super::super::{monitors::Monitor, DesktopError, Result};
use super::{model::Profile, packets::Packets};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdout, Command},
};

const START_TIMEOUT: Duration = Duration::from_secs(10);
const READ_BUFFER_BYTES: usize = 32 * 1024;

pub(super) struct Encoder {
    child: Child,
    output: ChildStdout,
    packets: Packets,
    buffer: Box<[u8]>,
    profile: Profile,
    pub width: u32,
    pub height: u32,
    pub bitrate: u32,
}

impl Encoder {
    pub async fn open(path: &Path, profile: Profile, display: &Monitor) -> Result<(Self, Vec<u8>)> {
        if profile.codec != super::codec::VideoCodec::H264 {
            return Err(DesktopError::Unsupported);
        }
        let display = display.clone();
        let display = tauri::async_runtime::spawn_blocking(move || display.refresh())
            .await
            .map_err(|_| DesktopError::Platform)??;
        let mut encoder = Self::spawn(path, profile, &display)?;
        let first = tokio::time::timeout(START_TIMEOUT, encoder.next()).await;
        match first {
            Ok(Ok(frame)) => Ok((encoder, frame)),
            _ => {
                encoder.stop().await;
                Err(DesktopError::Platform)
            }
        }
    }

    fn spawn(path: &Path, profile: Profile, display: &Monitor) -> Result<Self> {
        let width = profile.width.min(display.info.width) & !1;
        let height = ((u64::from(width) * u64::from(display.info.height)
            / u64::from(display.info.width)) as u32)
            & !1;
        if width == 0 || height == 0 {
            return Err(DesktopError::Platform);
        }
        let mut child = Command::new(path)
            .args([
                display.handle.to_string(),
                width.to_string(),
                height.to_string(),
                profile.fps.to_string(),
                profile.bitrate.to_string(),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| DesktopError::Platform)?;
        let output = child.stdout.take().ok_or(DesktopError::Platform)?;
        Ok(Self {
            child,
            output,
            packets: Packets::default(),
            buffer: vec![0; READ_BUFFER_BYTES].into_boxed_slice(),
            profile,
            width,
            height,
            bitrate: profile.bitrate,
        })
    }

    pub async fn next(&mut self) -> Result<Vec<u8>> {
        loop {
            if let Some(frame) = self.packets.next()? {
                return Ok(frame);
            }
            let length = self
                .output
                .read(&mut self.buffer)
                .await
                .map_err(|_| DesktopError::Platform)?;
            if length == 0 {
                return Err(DesktopError::Platform);
            }
            self.packets.push(&self.buffer[..length])?;
        }
    }

    pub fn info(&self) -> super::codec::EncoderInfo {
        super::codec::EncoderInfo::default()
    }

    pub async fn stop(&mut self) {
        self.child.stdin.take();
        if let Err(error) = self.child.kill().await {
            if error.kind() != std::io::ErrorKind::InvalidInput {
                eprintln!("desktop encoder cleanup: {error}");
            }
        }
    }

    pub async fn update(&mut self, profile: Profile) -> Result<bool> {
        if profile.width != self.profile.width
            || profile.fps != self.profile.fps
            || self.child.stdin.is_none()
        {
            return Ok(false);
        }
        self.control(profile.bitrate, profile.fps).await?;
        self.profile = profile;
        self.bitrate = profile.bitrate;
        Ok(true)
    }

    pub async fn request_keyframe(&mut self) -> Result<()> {
        if self.child.stdin.is_some() {
            self.control(0, 0).await?;
        }
        Ok(())
    }

    async fn control(&mut self, bitrate: u32, fps: u32) -> Result<()> {
        let input = self.child.stdin.as_mut().ok_or(DesktopError::Platform)?;
        let mut message = Vec::with_capacity(12);
        message.extend(0x3257_5343_u32.to_le_bytes());
        message.extend(bitrate.to_le_bytes());
        message.extend(fps.to_le_bytes());
        tokio::time::timeout(Duration::from_millis(250), input.write_all(&message))
            .await
            .map_err(|_| DesktopError::Platform)?
            .map_err(|_| DesktopError::Platform)
    }
}

pub(super) fn runtime_path(resource_dir: PathBuf) -> Result<PathBuf> {
    let relative = "resources/remote-desktop/runtime/desktop-video-macos";
    let path = resource_dir.join(relative);
    if path.is_file() {
        return Ok(path);
    }
    #[cfg(debug_assertions)]
    {
        let development = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        if development.is_file() {
            return Ok(development);
        }
    }
    Err(DesktopError::Platform)
}
