use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{bridge::Batch, AckRequest, ReconnectRequest, SendRequest};

pub(super) const COMMAND_LIMIT: usize = 128;
pub(super) const FRAME_LIMIT: usize = 64 * 1024;
pub(super) const DIAGNOSTIC_FRAME_LIMIT: usize = 4096;
const DIAGNOSTIC_EVENT_LIMIT: usize = 64;

#[derive(Debug, thiserror::Error)]
pub(super) enum ChatError {
    #[error("invalid chat frame")]
    InvalidFrame,
    #[error("chat transport failed")]
    Transport,
}

/// Peer frames and bounded diagnostics may cross IPC. Authentication stays in Rust.
#[derive(Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Outgoing {
    Signal { session_id: String, payload: Value },
    Diagnostic { session_id: String, payload: Value },
    Relay { session_id: String, payload: String },
    RelayRequest { session_id: String, reason: String },
    PeerClose { session_id: String },
}

impl Outgoing {
    pub(super) fn session_id(&self) -> &str {
        match self {
            Self::Signal { session_id, .. }
            | Self::Diagnostic { session_id, .. }
            | Self::Relay { session_id, .. }
            | Self::RelayRequest { session_id, .. }
            | Self::PeerClose { session_id } => session_id,
        }
    }

    pub(super) fn validate(&self) -> Result<(), ChatError> {
        if self.session_id().is_empty() || self.session_id().len() > 160 {
            return Err(ChatError::InvalidFrame);
        }
        if let Self::Relay { payload, .. } = self {
            // Bounded ASCII ciphertext plus the bounded session ID always fits FRAME_LIMIT.
            // Avoid serializing a full hexadecimal JSON envelope before writing a binary frame.
            return if payload.len() <= 40_000
                && payload
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                Ok(())
            } else {
                Err(ChatError::InvalidFrame)
            };
        }
        let limit = if matches!(self, Self::Diagnostic { .. }) {
            DIAGNOSTIC_FRAME_LIMIT
        } else {
            FRAME_LIMIT
        };
        if serde_json::to_vec(self)
            .map_err(|_| ChatError::InvalidFrame)?
            .len()
            > limit
        {
            return Err(ChatError::InvalidFrame);
        }
        match self {
            Self::Diagnostic { payload, .. } if !valid_diagnostic(payload) => {
                Err(ChatError::InvalidFrame)
            }
            Self::Signal { payload, .. }
                if !matches!(
                    payload["kind"].as_str(),
                    Some("key" | "sdp" | "ice" | "tcp")
                ) =>
            {
                Err(ChatError::InvalidFrame)
            }
            Self::RelayRequest { reason, .. }
                if !matches!(reason.as_str(), "timeout" | "disconnected") =>
            {
                Err(ChatError::InvalidFrame)
            }
            _ => Ok(()),
        }
    }
}

fn valid_diagnostic(payload: &Value) -> bool {
    // The coordinator owns the evolving event/field allowlist; IPC bounds the envelope and requires an event.
    payload.is_object()
        && payload["event"]
            .as_str()
            .is_some_and(|event| !event.is_empty() && event.len() <= DIAGNOSTIC_EVENT_LIMIT)
}

pub(super) enum Command {
    Attach {
        client_id: String,
        deliver: Box<dyn Fn(Batch) -> bool + Send>,
    },
    Detach(String),
    Reconnect(ReconnectRequest),
    Send(SendRequest),
    Bulk(super::bulk::BulkSend),
    Ack(AckRequest),
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub(super) enum Event {
    Reset,
    Disconnected,
    Ready,
    Closed { code: u16 },
    Message { data: String },
}

#[derive(Clone, Serialize)]
pub(super) struct Envelope {
    pub generation: u64,
    #[serde(flatten)]
    pub event: Event,
}
