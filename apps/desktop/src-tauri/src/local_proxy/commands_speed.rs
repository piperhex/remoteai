/// Compatibility entry point for clients that only support normal and fast mode.
#[tauri::command]
pub(crate) async fn set_local_proxy_fast_mode<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    let service_tier = if enabled {
        ProxyServiceTier::Priority
    } else {
        ProxyServiceTier::Default
    };
    set_local_proxy_service_tier(app, service_tier).await
}

/// Updates the external proxy's speed independently of GUI conversations.
#[tauri::command]
pub(crate) async fn set_local_proxy_service_tier<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    service_tier: ProxyServiceTier,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || update_external_service_tier(&app, service_tier))
        .await
        .map_err(|_| "Request speed could not be updated".to_string())?
        .map_err(|error| error.to_string())
}

#[derive(Debug, thiserror::Error)]
enum ExternalSpeedError {
    #[error("Start the local proxy before changing request speed")]
    Stopped,
    #[error("Fast mode is not available for the current provider")]
    Unavailable,
    #[error("Request speed settings could not be loaded")]
    Settings,
    #[error("Request speed changed, but its status could not be refreshed")]
    Notify,
}

fn update_external_service_tier<R: Runtime>(
    app: &tauri::AppHandle<R>,
    service_tier: ProxyServiceTier,
) -> Result<LocalProxyStatus, ExternalSpeedError> {
    if !is_running() {
        return Err(ExternalSpeedError::Stopped);
    }
    let paths = resolve_paths(app).map_err(|_| ExternalSpeedError::Settings)?;
    if service_tier != ProxyServiceTier::Default
        && !providers::current_target_supports_fast_mode(&paths)
    {
        return Err(ExternalSpeedError::Unavailable);
    }
    set_proxy_service_tier(service_tier);
    providers::refresh_codex_models_for_current_target(&paths);
    app.emit("providers-changed", ())
        .map_err(|_| ExternalSpeedError::Notify)?;
    Ok(status(app))
}
