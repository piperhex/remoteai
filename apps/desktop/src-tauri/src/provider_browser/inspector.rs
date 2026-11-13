//! User-operated inspectors. Only the trusted main view can place a tab's inspector.
use super::{Bounds, BrowserError, Result};
use serde::Deserialize;
use tauri::{Manager, Webview};

#[cfg(test)]
mod tests;
#[cfg(windows)]
pub(super) mod windows;

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Dock {
    Right,
    Bottom,
    Window,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Action {
    Status,
    Close,
    Place {
        // Non-Windows hosts still deserialize the shared placement request.
        #[cfg_attr(not(windows), allow(dead_code))]
        dock: Dock,
        bounds: Bounds,
        #[cfg_attr(not(windows), allow(dead_code))]
        visible: bool,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Kind {
    Provider,
    Conversation,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    id: uuid::Uuid,
    kind: Kind,
    command: Action,
}

fn target(owner: &Webview, request: &Request) -> Result<Webview> {
    if owner.label() != "main" {
        return Err(BrowserError::Invalid);
    }
    if let Action::Place { bounds, .. } = request.command {
        if !super::valid_bounds(bounds) {
            return Err(BrowserError::Invalid);
        }
    }
    let prefix = match request.kind {
        Kind::Provider => super::LABEL_PREFIX,
        Kind::Conversation => "conversation-browser-",
    };
    owner
        .app_handle()
        .get_webview(&format!("{prefix}{}", request.id))
        .ok_or(BrowserError::Unavailable)
}

#[tauri::command]
pub(crate) async fn browser_inspector(
    webview: Webview,
    request: Request,
) -> std::result::Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let view = target(&webview, &request)?;
        #[cfg(windows)]
        return windows::execute(&view, request.command);
        #[cfg(not(windows))]
        {
            let _ = view;
            Ok::<_, BrowserError>(false)
        }
    })
    .await
    .map_err(|_| BrowserError::Unavailable.to_string())?
    .map_err(|error| error.to_string())
}
