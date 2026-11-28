use super::{password_focus::valid_focus_id, BrowserError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tauri::{Manager, Webview};

const PAGE_SCRIPT: &str = include_str!("../../resources/browser-password.js");

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Login {
    origin: String,
    username: String,
    password: String,
}

impl Login {
    pub(super) fn valid_for(&self, source: &str) -> bool {
        valid_identity(&self.origin, &self.username, source)
            && !self.password.is_empty()
            && self.password.chars().count() <= 4096
    }
}

fn valid_identity(origin: &str, username: &str, source: &str) -> bool {
    url::Url::parse(source).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none()
            && origin == url.origin().ascii_serialization()
            && origin.len() <= 2048
            && username.chars().count() <= 512
    })
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LoginIdentity {
    origin: String,
    username: String,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum PasswordRequest {
    Take,
    TakeFocus,
    Fill {
        login: Login,
        #[serde(rename = "focusId", default, skip_serializing_if = "Option::is_none")]
        focus_id: Option<String>,
    },
    FillUsername {
        identity: LoginIdentity,
        #[serde(rename = "focusId", default, skip_serializing_if = "Option::is_none")]
        focus_id: Option<String>,
    },
}

pub(super) fn initialization() -> String {
    format!(
        "{PAGE_SCRIPT};RemoteAIBrowserPassword.passwordPage({{action:'install',desktop:true}});"
    )
}

async fn evaluate(view: Webview, request: PasswordRequest) -> Result<Value> {
    if matches!(
        request,
        PasswordRequest::Fill { .. } | PasswordRequest::FillUsername { .. }
    ) {
        let current = current_url(&view).await?;
        if !valid_fill(&request, current.as_str()) {
            return Err(BrowserError::Invalid);
        }
    }
    let args = serde_json::to_string(&request).map_err(|_| BrowserError::Invalid)?;
    let script = format!("{PAGE_SCRIPT};RemoteAIBrowserPassword.passwordPage({args});");
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = std::sync::Mutex::new(Some(send));
    view.eval_with_callback(script, move |value| {
        if let Ok(mut sender) = send.lock() {
            if let Some(sender) = sender.take() {
                // A closed tab or timeout intentionally retires the receiver.
                let _ = sender.send(value);
            }
        }
    })
    .map_err(|_| BrowserError::Unavailable)?;
    let raw = tokio::time::timeout(Duration::from_secs(5), receive)
        .await
        .map_err(|_| BrowserError::Unavailable)?
        .map_err(|_| BrowserError::Unavailable)?;
    let value: Value = serde_json::from_str(&raw).map_err(|_| BrowserError::Unavailable)?;
    let value = if let Some(text) = value.as_str() {
        serde_json::from_str(text).map_err(|_| BrowserError::Unavailable)?
    } else {
        value
    };
    if matches!(request, PasswordRequest::Take) && !value.is_null() {
        let login: Login =
            serde_json::from_value(value.clone()).map_err(|_| BrowserError::Invalid)?;
        if !login.valid_for(current_url(&view).await?.as_str()) {
            return Err(BrowserError::Invalid);
        }
    }
    if matches!(request, PasswordRequest::TakeFocus) && !value.is_null() {
        let focus: super::password_focus::PasswordFocus =
            serde_json::from_value(value.clone()).map_err(|_| BrowserError::Invalid)?;
        if !focus.valid_for(current_url(&view).await?.as_str()) {
            return Err(BrowserError::Invalid);
        }
    }
    Ok(value)
}

fn valid_fill(request: &PasswordRequest, source: &str) -> bool {
    match request {
        PasswordRequest::Fill { login, focus_id } => {
            login.valid_for(source) && focus_id.as_deref().is_none_or(valid_focus_id)
        }
        PasswordRequest::FillUsername { identity, focus_id } => {
            !identity.username.is_empty()
                && valid_identity(&identity.origin, &identity.username, source)
                && focus_id.as_deref().is_none_or(valid_focus_id)
        }
        _ => false,
    }
}

async fn current_url(view: &Webview) -> Result<url::Url> {
    let view = view.clone();
    tauri::async_runtime::spawn_blocking(move || view.url())
        .await
        .map_err(|_| BrowserError::Unavailable)?
        .map_err(|_| BrowserError::Unavailable)
}

/// Only the trusted main renderer can request the fixed form operation on an owned browser tab.
#[tauri::command]
pub(crate) async fn provider_browser_password(
    webview: Webview,
    id: String,
    request: PasswordRequest,
) -> std::result::Result<Value, String> {
    let label = super::label(&webview, &id).map_err(|error| error.to_string())?;
    let view = webview
        .app_handle()
        .get_webview(&label)
        .ok_or_else(|| BrowserError::Unavailable.to_string())?;
    evaluate(view, request)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn fill_requires_exact_http_or_https_origin() {
        for origin in [
            "https://example.test",
            "http://example.test",
            "http://127.0.0.1:8016",
        ] {
            let login = Login {
                origin: origin.into(),
                username: "user".into(),
                password: "secret".into(),
            };
            assert!(login.valid_for(&format!("{origin}/login")));
            for url in [
                "ftp://example.test",
                "https://example.test:8443",
                "http://evil.test",
                "https://u:p@example.test",
                "http://127.0.0.1:8017",
            ] {
                assert!(!login.valid_for(url));
            }
        }
        assert!(
            serde_json::from_value::<PasswordRequest>(json!({"action":"eval","script":"x"}))
                .is_err()
        );
    }

    #[test]
    fn username_only_fill_accepts_only_an_identity_and_current_origin() {
        let request: PasswordRequest = serde_json::from_value(json!({
            "action": "fillUsername",
            "identity": { "origin": "https://example.test", "username": "fixture@example.test" },
            "focusId": "focus-1"
        }))
        .unwrap();
        assert!(valid_fill(&request, "https://example.test/signin"));
        assert!(!valid_fill(&request, "https://example.test:8443/signin"));
        assert!(serde_json::from_value::<PasswordRequest>(json!({
            "action": "fillUsername",
            "identity": { "origin": "https://example.test", "username": "fixture", "password": "unexpected" }
        }))
        .is_err());
    }
}
