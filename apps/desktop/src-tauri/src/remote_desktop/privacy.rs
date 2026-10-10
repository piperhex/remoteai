//! Opt-in display ownership. Dropping the pipe asks an independent guardian to lock and restore.
use super::{displays::DisplayInfo, monitors, DesktopError, Result};
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::Duration,
};

const RESPONSE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resolutions: Vec<super::displays::Resolution>,
    pub displays: Vec<DisplayInfo>,
    pub display_id: String,
    pub privacy_screen: bool,
}

pub(super) struct Guardian {
    child: Option<Child>,
    input: Option<ChildStdin>,
    replies: Receiver<String>,
    original: String,
}

impl Guardian {
    pub fn prepare(runtime: &Path, original: String) -> Result<(Self, String)> {
        let name = if cfg!(windows) {
            "desktop-privacy.exe"
        } else {
            "desktop-privacy"
        };
        let executable = runtime.parent().ok_or(DesktopError::Privacy)?.join(name);
        let mut command = Command::new(executable);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // The guardian must outlive a service worker's kill-on-close job.
            command.creation_flags(0x0800_0000 | 0x0100_0000);
        }
        let mut child = command.spawn().map_err(|_| DesktopError::Privacy)?;
        let input = child.stdin.take();
        let output = child.stdout.take().ok_or(DesktopError::Privacy)?;
        let (sender, replies) = mpsc::sync_channel(4);
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let Ok(line) = line else { break };
                if line.len() > 128 || sender.send(line).is_err() {
                    break;
                }
            }
        });
        let guardian = Self {
            child: Some(child),
            input,
            replies,
            original,
        };
        let display = guardian
            .replies
            .recv_timeout(Duration::from_secs(25))
            .map_err(|_| DesktopError::Privacy)?;
        if display.is_empty() || display.len() > 128 {
            return Err(DesktopError::Privacy);
        }
        Ok((guardian, display))
    }

    pub fn send(&mut self, message: &str) -> Result<()> {
        writeln!(
            self.input.as_mut().ok_or(DesktopError::Privacy)?,
            "{message}"
        )
        .map_err(|_| DesktopError::Privacy)
    }

    fn acknowledged(&mut self, message: &str) -> Result<()> {
        self.send(message)?;
        match self.replies.recv_timeout(RESPONSE_TIMEOUT).as_deref() {
            Ok("ok") => Ok(()),
            _ => Err(DesktopError::Privacy),
        }
    }
}

impl Drop for Guardian {
    fn drop(&mut self) {
        // EOF is fail-closed, including panic, permission revocation and parent process exit.
        self.input.take();
        // Reap without delaying session cleanup; never kill a guardian restoring the displays.
        if let Some(mut child) = self.child.take() {
            std::thread::spawn(move || {
                if let Err(error) = child.wait() {
                    eprintln!("privacy guardian status: {error}");
                }
            });
        }
    }
}

pub(super) fn prepare(id: &str, runtime: &Path) -> Result<()> {
    let original = super::with_session(id, |session| {
        if !session.permissions.control {
            return Err(DesktopError::Denied);
        }
        if session.privacy.is_some() {
            return Err(DesktopError::Busy);
        }
        #[cfg(windows)]
        if !super::input_desktop::is_worker() {
            return Err(DesktopError::PrivacyService);
        }
        session.input.release()?;
        Ok(session.display.info.id.clone())
    })?;
    // Installation and arrival can wait; never hold the session lock during helper startup.
    let (guardian, display_id) = Guardian::prepare(runtime, original)?;
    let display = find_display(&display_id)?;
    super::with_session(id, |session| {
        session.privacy = Some(guardian);
        session.display = display;
        Ok(())
    })
}

fn find_display(id: &str) -> Result<monitors::Monitor> {
    for _ in 0..50 {
        if let Some(display) = monitors::list()?
            .into_iter()
            .find(|display| display.info.id == id)
        {
            return Ok(display);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(DesktopError::Privacy)
}

pub(super) fn commit(id: &str) -> Result<Snapshot> {
    super::with_session(id, |session| {
        session
            .privacy
            .as_mut()
            .ok_or(DesktopError::Privacy)?
            .acknowledged("commit")?;
        session.display = find_display(&session.display.info.id)?;
        session.touched = std::time::Instant::now();
        snapshot(session)
    })
}

pub(super) fn disable(id: &str) -> Result<Snapshot> {
    super::with_session(id, |session| {
        if !session.permissions.control {
            return Err(DesktopError::Denied);
        }
        session.input.release()?;
        if let Some(guardian) = session.privacy.as_mut() {
            guardian.acknowledged("disable")?;
            let displays = monitors::list()?;
            session.display = monitors::select(&displays, Some(&guardian.original))?;
            session.privacy = None;
        }
        session.touched = std::time::Instant::now();
        snapshot(session)
    })
}

pub(super) fn snapshot(session: &super::Session) -> Result<Snapshot> {
    Ok(Snapshot {
        #[cfg(windows)]
        resolutions: if session.permissions.control {
            super::resolutions::list(&session.display.info.id)
        } else {
            vec![]
        },
        #[cfg(not(windows))]
        resolutions: vec![],
        displays: monitors::list()?
            .into_iter()
            .map(|display| display.info)
            .collect(),
        display_id: session.display.info.id.clone(),
        privacy_screen: session.privacy.is_some(),
    })
}
