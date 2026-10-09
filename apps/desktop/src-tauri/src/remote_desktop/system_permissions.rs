//! Reuse the app's macOS grants without requiring the Computer Use plugin to be installed.
use crate::computer_use::permissions::{self, Permission, Permissions};

#[tauri::command]
pub(crate) async fn remote_desktop_system_permissions(
    window: tauri::Webview,
    request: Option<Permission>,
) -> std::result::Result<Option<Permissions>, String> {
    if window.label() != "main" {
        return Err(super::safe_error(super::DesktopError::Denied));
    }
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(request) = request {
            permissions::request(request).map_err(|error| error.to_string())?;
        }
        Ok(permissions::status())
    })
    .await
    .map_err(|_| super::safe_error(super::DesktopError::Platform))?
}
