/// Serialize this read/modify/write so unrelated preferences are retained.
pub(crate) fn update_quota_window_sync<R: Runtime>(
    app: &tauri::AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let _guard = APP_SETTINGS_WRITE_LOCK.lock()
        .map_err(|_| "settings.quotaWindowSync.saveError".to_string())?;
    let mut settings = read_app_settings(app)?;
    settings.quota_window_sync_enabled = enabled;
    let value = serde_json::to_value(&settings).map_err(|error| error.to_string())?;
    write_json_atomic(&app_settings_path(app)?, &value)?;
    Ok(settings)
}
