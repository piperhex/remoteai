//! Capture the current native page before application menus temporarily cover it.
use super::{automation, BrowserError};
use tauri::{Manager, Webview};

const PREVIEW_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

#[tauri::command]
pub(crate) async fn provider_browser_preview(
    webview: Webview,
    id: String,
) -> std::result::Result<automation::BrowserImage, String> {
    let view = tauri::async_runtime::spawn_blocking(move || {
        let label = super::label(&webview, &id)?;
        webview
            .app_handle()
            .get_webview(&label)
            .ok_or(BrowserError::Unavailable)
    })
    .await
    .map_err(|_| BrowserError::Unavailable.to_string())?
    .map_err(|error| error.to_string())?;
    tokio::time::timeout(PREVIEW_TIMEOUT, automation::capture_image(view))
        .await
        .map_err(|_| BrowserError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}
