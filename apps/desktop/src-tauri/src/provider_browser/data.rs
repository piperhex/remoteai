use super::{BrowserError, Result};
use serde::Deserialize;
use tauri::{LogicalPosition, LogicalSize, Manager, Webview};

#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ClearRequest {
    pub cookies: bool,
    pub cache: bool,
}

fn clear(owner: &Webview, request: ClearRequest) -> Result<()> {
    if owner.label() != "main" || !(request.cookies || request.cache) {
        return Err(BrowserError::Invalid);
    }
    let existing = owner
        .app_handle()
        .webviews()
        .into_iter()
        .find(|(label, _)| label.starts_with(super::LABEL_PREFIX))
        .map(|(_, view)| view);
    let temporary = existing.is_none();
    let view = match existing {
        Some(view) => view,
        None => owner
            .window()
            .add_child(
                super::browser_builder(owner, "provider-browser-data-cleaner")?,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1.0, 1.0),
            )
            .map_err(|_| BrowserError::Unavailable)?,
    };
    view.hide().map_err(|_| BrowserError::Unavailable)?;
    let result = clear_profile(&view, request);
    if temporary {
        view.close().map_err(|_| BrowserError::Unavailable)?;
    }
    result
}

#[cfg(windows)]
fn clear_profile(view: &Webview, request: ClearRequest) -> Result<()> {
    super::data_windows::clear(view, request)
}
#[cfg(not(windows))]
fn clear_profile(view: &Webview, request: ClearRequest) -> Result<()> {
    // Tauri's portable API cannot distinguish cookies from HTTP cache. Do not silently clear unselected data.
    if !request.cookies || !request.cache {
        return Err(BrowserError::Unavailable);
    }
    view.clear_all_browsing_data()
        .map_err(|_| BrowserError::Unavailable)
}

#[tauri::command]
pub(crate) async fn provider_browser_clear_data(
    webview: Webview,
    request: ClearRequest,
) -> std::result::Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clear(&webview, request))
        .await
        .map_err(|_| BrowserError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}
