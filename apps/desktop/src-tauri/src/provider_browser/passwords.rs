use super::{BrowserError, Result};
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
        let Ok(url) = url::Url::parse(source) else {
            return false;
        };
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && self.origin == url.origin().ascii_serialization()
            && self.origin.len() <= 2048
            && self.username.chars().count() <= 512
            && !self.password.is_empty()
            && self.password.chars().count() <= 4096
    }
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
}

pub(super) fn initialization() -> String {
    format!(
        "{PAGE_SCRIPT};RemoteAIBrowserPassword.passwordPage({{action:'install',desktop:true}});"
    )
}

async fn evaluate(view: Webview, request: PasswordRequest) -> Result<Value> {
    if let PasswordRequest::Fill { login, focus_id } = &request {
        let current = current_url(&view).await?;
        if !login.valid_for(current.as_str())
            || focus_id
                .as_ref()
                .is_some_and(|id| id.is_empty() || id.len() > 80)
        {
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
    fn fill_requires_exact_https_origin() {
        let login = Login {
            origin: "https://example.test".into(),
            username: "user".into(),
            password: "secret".into(),
        };
        assert!(login.valid_for("https://example.test/login"));
        for url in [
            "http://example.test",
            "https://example.test:8443",
            "https://evil.test",
            "https://u:p@example.test",
        ] {
            assert!(!login.valid_for(url));
        }
        assert!(
            serde_json::from_value::<PasswordRequest>(json!({"action":"eval","script":"x"}))
                .is_err()
        );
    }
}
