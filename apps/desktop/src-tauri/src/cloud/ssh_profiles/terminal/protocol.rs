use super::super::{valid_id, ProfileError};
use csw_ssh_client::{ExecutionOptions, Size, MAX_INPUT_BYTES};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub(crate) enum TerminalRequest {
    Open(Open),
    Read(Read),
    Write(Write),
    Password(Session),
    Resize(Resize),
    Close(Session),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Open {
    pub(super) thread_id: String,
    pub(super) profile_id: String,
    pub(super) revision: u64,
    pub(super) command: Option<String>,
    #[serde(default = "default_size")]
    pub(super) size: Size,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Read {
    pub(super) thread_id: String,
    pub(super) session_id: String,
    #[serde(default)]
    pub(super) cursor: u64,
    #[serde(default = "default_wait")]
    pub(super) wait_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Write {
    pub(super) thread_id: String,
    pub(super) session_id: String,
    pub(super) text: String,
    #[serde(default)]
    pub(super) sensitive: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Session {
    pub(super) thread_id: String,
    pub(super) session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Resize {
    pub(super) thread_id: String,
    pub(super) session_id: String,
    pub(super) size: Size,
}

fn default_size() -> Size {
    Size { cols: 80, rows: 24 }
}
fn default_wait() -> u64 {
    1000
}

impl TerminalRequest {
    pub(crate) fn owner(&self) -> (&str, Option<&str>) {
        match self {
            Self::Open(value) => (&value.thread_id, None),
            Self::Read(value) => (&value.thread_id, Some(&value.session_id)),
            Self::Write(value) => (&value.thread_id, Some(&value.session_id)),
            Self::Password(value) | Self::Close(value) => {
                (&value.thread_id, Some(&value.session_id))
            }
            Self::Resize(value) => (&value.thread_id, Some(&value.session_id)),
        }
    }

    pub(super) fn validate(&self) -> Result<(), ProfileError> {
        let (thread, session) = self.owner();
        if !valid_id(thread) || session.is_some_and(|id| !valid_id(id)) {
            return Err(ProfileError::Invalid);
        }
        let valid = match self {
            Self::Open(value) => valid_open(value),
            Self::Read(value) => value.wait_ms <= 30_000,
            Self::Write(value) => {
                !value.text.is_empty()
                    && value.text.len() <= MAX_INPUT_BYTES
                    && (!value.sensitive || secret_line(value.text.trim_end_matches(['\r', '\n'])))
            }
            Self::Resize(value) => value.size.validate().is_ok(),
            _ => true,
        };
        if valid {
            Ok(())
        } else {
            Err(ProfileError::Invalid)
        }
    }
}

fn valid_open(value: &Open) -> bool {
    valid_id(&value.profile_id)
        && value.revision > 0
        && value.revision <= 9_007_199_254_740_990
        && value.size.validate().is_ok()
        && value.command.as_ref().is_none_or(|command| {
            ExecutionOptions {
                command: command.clone(),
                timeout_seconds: 30,
            }
            .validate()
            .is_ok()
        })
}

pub(super) fn secret_line(value: &str) -> bool {
    !value.is_empty() && value.len() <= 4096 && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn bounds_input_and_rejects_passwords_in_open_requests_or_multiline_secret_input() {
        for input in [
            json!({"action":"open", "threadId":"one", "profileId":"saved", "revision":1, "password":"unsafe"}),
            json!({"action":"write", "threadId":"one", "sessionId":"two", "text":"secret\ncommand", "sensitive":true}),
            json!({"action":"read", "threadId":"one", "sessionId":"two", "waitMs":30001}),
            json!({"action":"write", "threadId":"one", "sessionId":"two", "text":"x".repeat(MAX_INPUT_BYTES+1)}),
        ] {
            assert!(serde_json::from_value::<TerminalRequest>(input)
                .map_or(true, |request| request.validate().is_err()));
        }
    }
}
