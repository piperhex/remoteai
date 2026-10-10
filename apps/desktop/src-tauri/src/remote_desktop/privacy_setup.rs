//! First-time setup has its own lifetime; user confirmation never stops capture or holds its lease.
use super::{DesktopError, Result};
use std::{
    os::windows::process::CommandExt,
    path::Path,
    process::{Command, Stdio},
};

const DRIVER_READY: i32 = 0;
const DRIVER_MISSING: i32 = 2;
const DESKTOP_LOCKED: i32 = 3;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

/// Called on a blocking worker after checking the viewer's control permission and service lease.
pub(super) fn prepare(runtime: &Path) -> Result<()> {
    let executable = runtime
        .parent()
        .ok_or(DesktopError::Privacy)?
        .join("desktop-privacy.exe");
    let status = command(&executable, "--check-driver")
        .status()
        .map_err(|_| DesktopError::Privacy)?;
    checked(status.code(), || {
        let mut installer = command(&executable, "--install-driver")
            .creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB)
            .spawn()
            .map_err(|_| DesktopError::Privacy)?;
        // The local user may finish setup after the viewer disconnects. Reap without blocking IPC.
        std::thread::spawn(move || {
            if let Err(error) = installer.wait() {
                eprintln!("privacy installer status: {error}");
            }
        });
        Ok(())
    })
}

fn command(executable: &Path, action: &str) -> Command {
    let mut command = Command::new(executable);
    command
        .arg(action)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

fn checked(code: Option<i32>, launch: impl FnOnce() -> Result<()>) -> Result<()> {
    match code {
        Some(DRIVER_READY) => Ok(()),
        Some(DRIVER_MISSING) => {
            launch()?;
            Err(DesktopError::PrivacySetup)
        }
        Some(DESKTOP_LOCKED) => Err(DesktopError::PrivacySetupLocked),
        _ => Err(DesktopError::Privacy),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_locked_or_failed_checks_never_launch_an_installer() {
        assert!(checked(Some(DRIVER_READY), || panic!("already installed")).is_ok());
        assert!(matches!(
            checked(Some(DESKTOP_LOCKED), || panic!("locked")),
            Err(DesktopError::PrivacySetupLocked)
        ));
        for code in [None, Some(1), Some(4)] {
            assert!(matches!(
                checked(code, || panic!("failed check")),
                Err(DesktopError::Privacy)
            ));
        }
    }

    #[test]
    fn missing_driver_requests_confirmation_before_accepting_a_privacy_transition() {
        let mut launched = false;
        assert!(matches!(
            checked(Some(DRIVER_MISSING), || {
                launched = true;
                Ok(())
            }),
            Err(DesktopError::PrivacySetup)
        ));
        assert!(launched);
        assert!(matches!(
            checked(Some(DRIVER_MISSING), || Err(DesktopError::Privacy)),
            Err(DesktopError::Privacy)
        ));
    }
}
