use super::{RemoteError, Result};
use serde::{Deserialize, Serialize};

pub(super) const MAX_COMMAND_BYTES: usize = 16 * 1024;
pub(super) const MAX_OUTPUT_BYTES: usize = 64 * 1024;
pub(super) const MAX_TIMEOUT_SECONDS: u64 = 60;
pub(super) const REQUEST_BYTES: u64 = 32 * 1024;
pub(super) const MAX_CONCURRENT_COMMANDS: usize = 32;

pub(crate) fn default_concurrency_limit() -> usize {
    5
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Shell {
    #[default]
    Auto,
    Powershell,
    Sh,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommandRequest {
    pub command: String,
    pub cwd: Option<String>,
    #[serde(default)]
    pub shell: Shell,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
}

fn default_timeout() -> u64 {
    30
}

impl CommandRequest {
    pub(super) fn validate(&self) -> Result<()> {
        let valid = !self.command.trim().is_empty()
            && self.command.len() <= MAX_COMMAND_BYTES
            && !self.command.contains('\0')
            && (1..=MAX_TIMEOUT_SECONDS).contains(&self.timeout_seconds)
            && self
                .cwd
                .as_ref()
                .is_none_or(|cwd| !cwd.is_empty() && cwd.len() <= 4096 && !cwd.contains('\0'));
        if valid {
            Ok(())
        } else {
            Err(RemoteError::InvalidRequest)
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ExecuteRequest {
    pub device_id: String,
    #[serde(flatten)]
    pub command: CommandRequest,
}

impl ExecuteRequest {
    pub fn validate(&self) -> Result<()> {
        uuid::Uuid::parse_str(&self.device_id).map_err(|_| RemoteError::InvalidRequest)?;
        self.command.validate()
    }
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum ToolRequest {
    List,
    Execute { request: ExecuteRequest },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub truncated: bool,
    pub duration_ms: u64,
}
