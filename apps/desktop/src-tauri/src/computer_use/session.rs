use super::{install, package, platform, state, ComputerError, Result};
use std::{
    path::Path,
    process::{Child, Command, Stdio},
    thread,
    time::Duration,
};

const REVOCATION_INTERVAL: Duration = Duration::from_millis(250);

struct Driver(Child);

impl Drop for Driver {
    fn drop(&mut self) {
        if let Ok(Some(_)) = self.0.try_wait() {
            return;
        }
        if self.0.kill().is_err() {
            eprintln!("Could not stop computer-use session");
        }
        if self.0.wait().is_err() {
            eprintln!("Could not reap computer-use session");
        }
    }
}

pub(super) fn run(root: &Path, id: &str) -> Result<()> {
    let shutdown = platform::shutdown_signal()?;
    let record = state::read(root, id)?
        .filter(|record| record.enabled)
        .ok_or(ComputerError::Disabled)?;
    if !install::configured(&record.home, true)? || !package::present(root)? {
        return Err(ComputerError::Disabled);
    }
    #[cfg(windows)]
    if super::administrator::connect(root, id)? {
        return Ok(());
    }
    let mut command = driver_command(root)?;
    command
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    let mut driver = Driver(command.spawn().map_err(|_| ComputerError::Startup)?);
    loop {
        if !state::allowed(root, id, &record.generation) {
            return Ok(());
        }
        if shutdown.load(std::sync::atomic::Ordering::Acquire) {
            return Ok(());
        }
        if let Some(status) = driver.0.try_wait().map_err(|_| ComputerError::Startup)? {
            return if status.success() {
                Ok(())
            } else {
                Err(ComputerError::Startup)
            };
        }
        thread::sleep(REVOCATION_INTERVAL);
    }
}

/// Shared launch policy for Codex GUI and the product help assistant.
pub(super) fn driver_command(root: &Path) -> Result<Command> {
    Ok(command_for_executable(&package::executable(root)?))
}

pub(super) fn command_for_executable(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    if let Some(directory) = executable.parent() {
        command.current_dir(directory);
    }
    command
        .args(["mcp", "--direct"])
        .env("CUA_DRIVER_PERMISSION_MODE", "standard")
        .env("CUA_DRIVER_RS_TELEMETRY_ENABLED", "0");
    platform::configure_driver(&mut command);
    command
}
