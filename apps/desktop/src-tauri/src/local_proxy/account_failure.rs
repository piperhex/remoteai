use super::{is_official_quota_exhaustion, json_payload, TokenUsageAccount, UpstreamPayload};
use crate::codex_api::TokenRefreshError;
use serde_json::json;

/// Authentication failures cannot recover by retrying the same account. Keep this
/// separate from quota detection so an expired login never consumes a quota reset.
pub(super) fn is_authentication_failure(response: &UpstreamPayload) -> bool {
    matches!(response.status, 401 | 403)
}

pub(super) fn requires_account_failover(response: &UpstreamPayload) -> bool {
    is_authentication_failure(response) || is_official_quota_exhaustion(response)
}

#[derive(Debug, thiserror::Error)]
pub(super) enum CredentialError {
    #[error("{error}")]
    Refresh {
        error: TokenRefreshError,
        account: TokenUsageAccount,
    },
    #[error("{0}")]
    Other(String),
}

impl From<String> for CredentialError {
    fn from(message: String) -> Self {
        Self::Other(message)
    }
}

impl CredentialError {
    /// Preserve the account that actually failed, including explicit GUI routes.
    pub(super) fn into_response(self) -> Result<UpstreamPayload, String> {
        let Self::Refresh { error, account } = self else {
            return Err(self.to_string());
        };
        let Some(status) = error.authentication_status() else {
            return Err(error.to_string());
        };
        let mut response = json_payload(status, json!({"error": {"message": error.to_string()}}));
        response.token_usage_account = Some(account);
        Ok(response)
    }
}
