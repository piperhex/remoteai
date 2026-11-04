//! Platform shell selection and cancellation, isolated from the command protocol.
use super::{protocol::Shell, RemoteError, Result};
use std::process::Stdio;
use tokio::process::{Child, Command};

#[cfg(target_os = "macos")]
static SPAWN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Keep concurrent remote commands from inheriting each other's capture pipes on macOS.
pub(super) async fn spawn(command: &mut Command) -> std::io::Result<Child> {
    // macOS creates pipes and sets CLOEXEC separately (rust-lang/rust#95584).
    // Only process creation is serialized; commands execute and drain concurrently.
    #[cfg(target_os = "macos")]
    let _guard = SPAWN_LOCK.lock().await;
    command.spawn()
}

pub(super) fn project_script(command: &str) -> String {
    #[cfg(windows)]
    {
        format!(
            "$env:CI='true'; {}; exit $LASTEXITCODE",
            command.replacen("npm ", "npm.cmd ", 1)
        )
    }
    #[cfg(not(windows))]
    {
        format!("CI=true {command}")
    }
}

pub(super) struct ProcessTree {
    #[cfg(windows)]
    _job: std::os::windows::io::OwnedHandle,
}

impl ProcessTree {
    /// Close the Windows job before draining pipes; Unix cancellation uses the process group below.
    pub(super) fn finish(self) {
        #[cfg(windows)]
        drop(self._job);
    }
}

pub(super) fn track(child: &Child) -> Result<ProcessTree> {
    #[cfg(windows)]
    {
        Ok(ProcessTree {
            _job: super::windows_job::track(child)?,
        })
    }
    #[cfg(not(windows))]
    {
        child.id().ok_or(RemoteError::Execution)?;
        Ok(ProcessTree {})
    }
}

pub(super) fn command(shell: &Shell, script: &str) -> Result<Command> {
    #[cfg(windows)]
    let mut command = {
        if matches!(shell, Shell::Sh) {
            return Err(RemoteError::InvalidRequest);
        }
        let system = std::env::var_os("SystemRoot").ok_or(RemoteError::Execution)?;
        let mut command = Command::new(
            std::path::PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
        );
        // Script is one argument, not interpolated into a wrapper command. UTF-8 preserves diagnostics.
        let script =
            format!("[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new();\n{script}");
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &script,
        ]);
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        use std::os::unix::process::CommandExt;
        if matches!(shell, Shell::Powershell) {
            return Err(RemoteError::InvalidRequest);
        }
        let mut command = Command::new("/bin/sh");
        command.args(["-c", script]);
        command.as_std_mut().process_group(0);
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    Ok(command)
}

pub(super) async fn stop(child: &mut Child, pid: u32) {
    #[cfg(windows)]
    let result = {
        let system = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        Command::new(std::path::PathBuf::from(system).join("System32/taskkill.exe"))
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
    };
    #[cfg(not(windows))]
    let result = {
        let mut command = Command::new("/bin/kill");
        command
            .args(["-KILL", "--", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        match spawn(&mut command).await {
            Ok(mut cleanup) => cleanup.wait().await,
            Err(error) => Err(error),
        }
    };
    if !result.is_ok_and(|status| status.success()) {
        // A process that already exited needs no further termination; kill_on_drop is the fallback.
        if let Err(error) = child.kill().await {
            if error.kind() != std::io::ErrorKind::InvalidInput {
                eprintln!("remote command cleanup: {error}");
            }
        }
    }
}
