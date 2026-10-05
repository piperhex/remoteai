#[tauri::command]
pub(crate) async fn get_app_settings<R: Runtime>(app: AppHandle<R>) -> Result<AppSettings, String> {
    tauri::async_runtime::spawn_blocking(move || read_app_settings(&app))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn set_floating_bubble<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    update_floating_bubble(app, Some(enabled)).await
}

pub(crate) async fn toggle_floating_bubble<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AppSettings, String> {
    update_floating_bubble(app, None).await
}

async fn update_floating_bubble<R: Runtime>(
    app: AppHandle<R>,
    enabled: Option<bool>,
) -> Result<AppSettings, String> {
    let storage_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        lifecycle::update_enabled(&storage_app, enabled)
    })
    .await
    .map_err(|error| format!("Floating usage setting task failed: {error}"))?;
    crate::system_tray::refresh_menu(&app);
    result
}

#[tauri::command]
pub(crate) fn set_privacy_mode<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.privacy_mode = enabled;
    write_app_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_hide_account_notes<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.hide_account_notes = enabled;
    write_app_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_show_usage_network_errors<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.show_usage_network_errors = enabled;
    write_app_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn set_token_usage_preferences<R: Runtime + 'static>(
    app: AppHandle<R>,
    weeks: u16,
    refresh_seconds: u64,
    codex_summary_enabled: Option<bool>,
) -> Result<AppSettings, String> {
    if !(MIN_TOKEN_USAGE_WEEKS..=MAX_TOKEN_USAGE_WEEKS).contains(&weeks) {
        return Err(format!(
            "token usage weeks must be between {MIN_TOKEN_USAGE_WEEKS} and {MAX_TOKEN_USAGE_WEEKS}"
        ));
    }
    if !(MIN_TOKEN_USAGE_REFRESH_SECONDS..=MAX_TOKEN_USAGE_REFRESH_SECONDS)
        .contains(&refresh_seconds)
    {
        return Err(format!(
            concat!(
                "token usage refresh interval must be between {} ",
                "and {} seconds"
            ),
            MIN_TOKEN_USAGE_REFRESH_SECONDS,
            MAX_TOKEN_USAGE_REFRESH_SECONDS
        ));
    }

    let summary_setting_changed = codex_summary_enabled.is_some();
    let settings = tauri::async_runtime::spawn_blocking(move || {
        let mut settings = read_app_settings(&app)?;
        settings.token_usage_weeks = weeks;
        settings.token_usage_refresh_seconds = refresh_seconds;
        if let Some(enabled) = codex_summary_enabled {
            settings.codex_usage_summary_enabled = enabled;
        }
        write_app_settings(&app, &settings)?;
        Ok::<_, String>(settings)
    })
    .await
    .map_err(|error| format!("Token usage settings task failed: {error}"))??;
    if summary_setting_changed {
        crate::codex_runtime::refresh_usage_summary();
    }
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_bubble_reset_display<R: Runtime>(
    app: AppHandle<R>,
    display: BubbleResetDisplay,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.bubble_reset_display = display;
    write_app_settings(&app, &settings)?;
    let event_name = "bubble-reset-display-changed";
    let event_payload = settings.bubble_reset_display.clone();
    app.emit(event_name, event_payload.clone())
        .map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        window
            .emit(event_name, event_payload)
            .map_err(|error| error.to_string())?;
    }
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_bubble_style<R: Runtime>(
    app: AppHandle<R>,
    style: BubbleStyle,
) -> Result<AppSettings, String> {
    let mut settings = read_app_settings(&app)?;
    settings.bubble_style = style;
    write_app_settings(&app, &settings)?;
    resize_window_for_style(&app, &settings.bubble_style)?;

    let event_name = "bubble-style-changed";
    let event_payload = settings.bubble_style.clone();
    app.emit(event_name, event_payload.clone())
        .map_err(|error| error.to_string())?;
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        window
            .emit(event_name, event_payload)
            .map_err(|error| error.to_string())?;
    }
    Ok(settings)
}

#[tauri::command]
pub(crate) fn set_theme_color<R: Runtime>(
    app: AppHandle<R>,
    color: String,
) -> Result<AppSettings, String> {
    if !is_hex_color(&color) {
        return Err("theme color must be a #rrggbb hex value".to_string());
    }
    let normalized = color.to_ascii_lowercase();
    let mut settings = read_app_settings(&app)?;
    settings.theme_color = Some(normalized.clone());
    write_app_settings(&app, &settings)?;
    app.emit("theme-color-changed", normalized)
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn set_app_language<R: Runtime>(
    app: AppHandle<R>,
    language: String,
) -> Result<(), String> {
    if !matches!(language.as_str(), "en" | "zh" | "ru") {
        return Err("language must be en, zh or ru".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || save_app_language(&app, language))
        .await
        .map_err(|error| {
            eprintln!("language settings task failed: {error}");
            "Could not save language settings".to_string()
        })?
}

fn save_app_language<R: Runtime>(app: &AppHandle<R>, language: String) -> Result<(), String> {
    crate::storage::save_app_language(app, &language).map_err(|error| {
        eprintln!("language preference could not be saved: {error}");
        "Could not save language settings".to_string()
    })?;
    crate::system_tray::refresh_menu(app);
    crate::codex_runtime::refresh_usage_summary();
    Ok(())
}

fn is_hex_color(color: &str) -> bool {
    color.len() == HEX_COLOR_LEN
        && color.starts_with('#')
        && color.chars().skip(1).all(|char| char.is_ascii_hexdigit())
}
