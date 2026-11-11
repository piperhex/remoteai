use super::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Do not derive Debug: access and refresh tokens must never enter logs or IPC responses.
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct Credentials {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subscription_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_limit_tier: Option<String>,
}

impl Credentials {
    pub(super) fn parse(value: &Value) -> Result<Self> {
        let credentials: Self =
            serde_json::from_value(value.clone()).map_err(|_| Error::SignedOut)?;
        if credentials.access_token.is_empty() || credentials.expires_at <= 0 {
            return Err(Error::SignedOut);
        }
        Ok(credentials)
    }

    pub(super) fn expiring(&self) -> bool {
        self.expires_at <= chrono::Utc::now().timestamp_millis() + 300_000
    }

    pub(super) fn newer_than(&self, previous: &Self) -> bool {
        self.expires_at > previous.expires_at && self.refresh_token.is_some()
    }
}
