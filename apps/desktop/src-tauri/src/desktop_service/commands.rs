use super::{installer, setup, Result, ServiceError};
use serde::Serialize;
use tauri::{AppHandle, Webview};
use windows_service::service::ServiceState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServiceStatus {
    supported: bool,
    installed: bool,
    running: bool,
}
fn status() -> Result<ServiceStatus> {
    let service = installer::query()?;
    Ok(ServiceStatus {
        supported: setup::supported(),
        installed: service.is_some(),
        running: service.is_some_and(|value| value.current_state == ServiceState::Running),
    })
}
fn local(window: &Webview) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(ServiceError::Denied)
    }
}

#[tauri::command]
pub(crate) async fn remote_desktop_service_status(
    window: Webview,
) -> std::result::Result<ServiceStatus, String> {
    local(&window).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(status)
        .await
        .map_err(|_| ServiceError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn remote_desktop_service_install(
    app: AppHandle,
    window: Webview,
) -> std::result::Result<ServiceStatus, String> {
    local(&window).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        setup::install(&app)?;
        status()
    })
    .await
    .map_err(|_| ServiceError::Unavailable.to_string())?
    .map_err(|error: ServiceError| error.to_string())
}
#[tauri::command]
pub(crate) async fn remote_desktop_service_uninstall(
    window: Webview,
) -> std::result::Result<ServiceStatus, String> {
    local(&window).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(|| {
        setup::uninstall()?;
        status()
    })
    .await
    .map_err(|_| ServiceError::Unavailable.to_string())?
    .map_err(|error: ServiceError| error.to_string())
}
