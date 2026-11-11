use super::{Error, Result};
use serde::Deserialize;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const PROBE_TIMEOUT: Duration = Duration::from_secs(20);
pub(super) const AUTH_ENVIRONMENT: [&str; 7] = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
];

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Identity {
    #[serde(default)]
    pub logged_in: bool,
    pub auth_method: Option<String>,
    pub email: Option<String>,
}

/// Resolve only CLI binaries or the npm package's documented executable; never Claude Desktop.
pub(super) fn command(root: &Path, directory: Option<&Path>) -> Result<Command> {
    let package = root.join("cli-gui/runtime/node_modules/@anthropic-ai/claude-code");
    let native = package.join(if cfg!(windows) {
        "bin/claude.exe"
    } else {
        "bin/claude"
    });
    let mut command = if native.is_file() {
        Command::new(native)
    } else if package.join("cli.js").is_file() {
        let mut command = Command::new("node");
        command.arg(package.join("cli.js"));
        command
    } else {
        Command::new(installed_binary().ok_or(Error::CliRequired)?)
    };
    for key in AUTH_ENVIRONMENT {
        command.env_remove(key);
    }
    if let Some(directory) = directory {
        command.env("CLAUDE_CONFIG_DIR", directory);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    Ok(command)
}

fn installed_binary() -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };
    let home = dirs::home_dir()?;
    let mut directories = vec![home.join(".local/bin"), home.join(".config/devai/bin")];
    if let Some(path) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path));
    }
    directories
        .into_iter()
        .map(|path| path.join(name))
        .find(|path| {
            path.is_file()
                && !path
                    .components()
                    .any(|part| part.as_os_str().eq_ignore_ascii_case("WindowsApps"))
        })
}

pub(super) fn identity(root: &Path, directory: &Path) -> Result<Identity> {
    let mut child = command(root, Some(directory))?
        .args(["auth", "status", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| Error::CliRequired)?;
    let started = Instant::now();
    loop {
        if child.try_wait().map_err(|_| Error::Login)?.is_some() {
            break;
        }
        if started.elapsed() >= PROBE_TIMEOUT {
            child.kill().map_err(|_| Error::Login)?;
            child.wait().map_err(|_| Error::Login)?;
            return Err(Error::Login);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let output = child.wait_with_output().map_err(|_| Error::Login)?;
    let identity: Identity = serde_json::from_slice(&output.stdout).map_err(|_| Error::Login)?;
    if !identity.logged_in || identity.auth_method.as_deref() != Some("claude.ai") {
        return Err(Error::SignedOut);
    }
    if identity
        .email
        .as_deref()
        .is_none_or(|email| email.trim().is_empty())
    {
        return Err(Error::SignedOut);
    }
    Ok(identity)
}
