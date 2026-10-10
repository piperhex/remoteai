//! Reuse the app's macOS grants without requiring the Computer Use plugin to be installed.
use crate::computer_use::permissions::{self, Permission, Permissions};

/// Repair is local-only; it is deliberately absent from the remote desktop RPC.
#[tauri::command]
pub(crate) async fn remote_desktop_repair_system_permission(
    window: tauri::Webview,
    permission: Permission,
) -> std::result::Result<permissions::RepairResult, String> {
    if window.label() != "main" {
        return Err(super::safe_error(super::DesktopError::Denied));
    }
    tauri::async_runtime::spawn_blocking(move || permissions::repair(permission))
        .await
        .map_err(|_| super::safe_error(super::DesktopError::Platform))?
        .map_err(|error| error.to_string())
}

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
