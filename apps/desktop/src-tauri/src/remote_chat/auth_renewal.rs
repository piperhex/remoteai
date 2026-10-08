//! Negotiated credential renewal stays on the native socket; tokens never cross the WebView bridge.
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tungstenite::Message;

const RENEWAL_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub(super) struct AuthRenewal {
    supported: bool,
    pending: Option<Instant>,
}

impl AuthRenewal {
    pub fn receive(&mut self, message: &Value) {
        match message["type"].as_str() {
            Some("chat-policy") => self.supported = message["authRenewal"] == true,
            Some("auth-renewed") => self.pending = None,
            _ => {}
        }
    }

    pub fn request(&mut self, access_token: &str) -> Option<Message> {
        if !self.supported {
            return None;
        }
        self.pending = Some(Instant::now());
        Some(Message::Text(
            json!({"type": "renew-auth", "accessToken": access_token})
                .to_string()
                .into(),
        ))
    }

    pub fn timed_out(&self) -> bool {
        self.pending
            .is_some_and(|started| started.elapsed() >= RENEWAL_TIMEOUT)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negotiation_and_acknowledgement_bound_native_renewal() {
        let mut renewal = AuthRenewal::default();
        assert!(renewal.request("new-token").is_none());
        renewal.receive(&json!({"type": "chat-policy", "authRenewal": true}));
        let frame = renewal.request("new-token").unwrap();
        let payload: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
        assert_eq!(
            payload,
            json!({"type": "renew-auth", "accessToken": "new-token"})
        );
        renewal.pending = Some(Instant::now() - RENEWAL_TIMEOUT);
        assert!(renewal.timed_out());
        renewal.receive(&json!({"type": "auth-renewed"}));
        assert!(!renewal.timed_out());
        renewal.receive(&json!({"type": "chat-policy"}));
        assert!(renewal.request("other-token").is_none());
    }
}
