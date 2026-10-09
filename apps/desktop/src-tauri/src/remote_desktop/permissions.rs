//! Host-owned desktop permissions. Remote clients cannot widen these settings.
use super::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};
use tauri::{AppHandle, Manager, Webview};

static SETTINGS: Mutex<()> = Mutex::new(());
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Permissions {
    pub enabled: bool,
    pub control: bool,
    pub clipboard_read: bool,
    pub clipboard_write: bool,
    pub files: bool,
    pub audio: bool,
}
impl Default for Permissions {
    fn default() -> Self {
        Self {
            enabled: true,
            control: true,
            clipboard_read: true,
            clipboard_write: true,
            files: true,
            audio: true,
        }
    }
}

fn read(root: &Path) -> Result<Permissions> {
    match std::fs::read(root.join("remote-desktop-permissions.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| DesktopError::Settings),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Permissions::default()),
        Err(_) => Err(DesktopError::Settings),
    }
}

pub(super) fn open(
    app: &AppHandle,
    display_id: Option<String>,
    expires_at: Option<u64>,
) -> Result<super::displays::Opened> {
    let _guard = SETTINGS.lock().map_err(|_| DesktopError::Settings)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| DesktopError::Settings)?;
    super::open(display_id, read(&root)?, expires_at)
}

#[cfg(windows)]
pub(crate) fn snapshot(app: &AppHandle) -> Result<Permissions> {
    let _guard = SETTINGS.lock().map_err(|_| DesktopError::Platform)?;
    read(
        &app.path()
            .app_data_dir()
            .map_err(|_| DesktopError::Platform)?,
    )
}

#[tauri::command]
pub(crate) async fn remote_desktop_permissions(
    app: AppHandle,
    window: Webview,
    settings: Option<Permissions>,
) -> std::result::Result<Permissions, String> {
    if window.label() != "main" {
        return Err(super::safe_error(DesktopError::Denied));
    }
    #[cfg(windows)]
    if crate::desktop_service::control::permission_service(settings.is_some())
        .await
        .map_err(|error| error.to_string())?
    {
        if let Some(settings) = settings {
            crate::desktop_service::control::update(settings)
                .await
                .map_err(|error| error.to_string())?;
        } else {
            return crate::desktop_service::control::read()
                .await
                .map(|snapshot| snapshot.permissions)
                .map_err(|error| error.to_string());
        }
    }
    let updated = settings.is_some();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = SETTINGS.lock().map_err(|_| DesktopError::Platform)?;
        let root = app
            .path()
            .app_data_dir()
            .map_err(|_| DesktopError::Platform)?;
        let Some(settings) = settings else {
            return read(&root);
        };
        std::fs::create_dir_all(&root).map_err(|_| DesktopError::Platform)?;
        crate::storage::write_json_atomic(
            &root.join("remote-desktop-permissions.json"),
            &serde_json::to_value(settings).map_err(|_| DesktopError::Platform)?,
        )
        .map_err(|_| DesktopError::Platform)?;
        // Revoke the old lease immediately; every reconnect must load the new restrictions.
        super::revoke()?;
        Ok(settings)
    })
    .await
    .map_err(|_| super::safe_error(DesktopError::Platform))?
    .map_err(super::safe_error)?;
    if updated {
        super::stream::revoke().await;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_settings_keep_defaults_but_corrupt_settings_have_a_distinct_error() {
        let root = tempfile::tempdir().unwrap();
        assert!(read(root.path()).unwrap().enabled);
        let path = root.path().join("remote-desktop-permissions.json");
        std::fs::write(&path, b"{private-invalid-settings").unwrap();
        assert!(matches!(read(root.path()), Err(DesktopError::Settings)));
        let message = super::super::safe_error(read(root.path()).err().unwrap());
        assert!(!message.contains("private"));
        assert!(!message.contains(&path.to_string_lossy().to_string()));
    }

    #[test]
    fn unreadable_settings_are_not_reported_as_capture_failures() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("remote-desktop-permissions.json")).unwrap();
        assert!(matches!(read(root.path()), Err(DesktopError::Settings)));
    }
}
