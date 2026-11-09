use super::{apply_refreshed_tokens, token_string, Client, Value, CLIENT_ID, ISSUER, ORIGINATOR};
use chrono::Utc;
use serde_json::json;

#[cfg(test)]
thread_local! {
    static TEST_ENDPOINT: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
pub(crate) fn with_refresh_endpoint<T>(endpoint: &str, run: impl FnOnce() -> T) -> T {
    struct Reset(Option<String>);
    impl Drop for Reset {
        fn drop(&mut self) {
            TEST_ENDPOINT.with(|value| *value.borrow_mut() = self.0.take());
        }
    }
    let _reset = Reset(TEST_ENDPOINT.with(|value| value.replace(Some(endpoint.to_owned()))));
    run()
}

fn refresh_endpoint() -> String {
    #[cfg(test)]
    if let Some(endpoint) = TEST_ENDPOINT.with(|value| value.borrow().clone()) {
        return endpoint;
    }
    format!("{ISSUER}/oauth/token")
}

/// Preserve an authentication rejection as structured data for account failover.
#[derive(Debug, thiserror::Error)]
pub(crate) enum TokenRefreshError {
    #[error("{message}")]
    Authentication { status: u16, message: String },
    #[error("{0}")]
    Other(String),
}

impl From<String> for TokenRefreshError {
    fn from(message: String) -> Self {
        Self::Other(message)
    }
}

impl TokenRefreshError {
    pub(crate) fn authentication_status(&self) -> Option<u16> {
        match self {
            Self::Authentication { status, .. } => Some(*status),
            Self::Other(_) => None,
        }
    }

    fn rejected(status: reqwest::StatusCode) -> Self {
        let message = format!("刷新登录凭据失败（HTTP {status}），请重新登录");
        if matches!(status.as_u16(), 401 | 403) {
            Self::Authentication {
                status: status.as_u16(),
                message,
            }
        } else {
            Self::Other(message)
        }
    }
}

pub(crate) fn refresh_tokens(client: &Client, auth: &mut Value) -> Result<(), String> {
    refresh_tokens_classified(client, auth).map_err(|error| error.to_string())
}

pub(crate) fn refresh_tokens_classified(
    client: &Client,
    auth: &mut Value,
) -> Result<(), TokenRefreshError> {
    let refresh_token =
        token_string(auth, "refresh_token").ok_or_else(|| TokenRefreshError::Authentication {
            status: 401,
            message: "登录已过期，且 auth.json 中没有 refresh_token；请重新登录".to_string(),
        })?;
    let response = client
        .post(refresh_endpoint())
        .header("Content-Type", "application/json")
        .header("originator", ORIGINATOR)
        .json(&json!({
            "client_id": CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .map_err(|error| format!("刷新登录凭据失败：{error}"))?;
    if !response.status().is_success() {
        return Err(TokenRefreshError::rejected(response.status()));
    }
    let payload: Value = response
        .json()
        .map_err(|error| format!("解析刷新响应失败：{error}"))?;
    apply_refreshed_tokens(auth, &payload, Utc::now()).map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_authentication_rejections_are_distinct_from_transient_errors() {
        for status in [400, 401, 403, 429, 500, 503] {
            let error = TokenRefreshError::rejected(reqwest::StatusCode::from_u16(status).unwrap());
            assert_eq!(
                error.authentication_status(),
                matches!(status, 401 | 403).then_some(status)
            );
        }
        assert_eq!(
            TokenRefreshError::Other("HTTP 401 in unrelated text".into()).authentication_status(),
            None
        );
    }

    #[test]
    fn missing_refresh_token_is_an_authentication_failure_without_a_network_request() {
        let error =
            refresh_tokens_classified(&Client::new(), &mut json!({"tokens": {}})).unwrap_err();
        assert_eq!(error.authentication_status(), Some(401));
    }
}
