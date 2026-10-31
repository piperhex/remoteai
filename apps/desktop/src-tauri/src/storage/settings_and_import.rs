fn read_state_unlocked(paths: &Paths) -> Result<ManagerStateFile, String> {
    let bytes = match fs::read(&paths.state_file) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(ManagerStateFile::default());
        }
        Err(error) => return Err(format!("Failed to read application state: {error}")),
    };
    let state = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Application state is invalid: {error}"))?;
    cache_state(paths, &state);
    Ok(state)
}

fn cache_state(paths: &Paths, state: &ManagerStateFile) {
    let cache = STATE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        cache.insert(paths.state_file.clone(), state.clone());
    }
}

fn cached_state(paths: &Paths) -> Option<ManagerStateFile> {
    STATE_CACHE
        .get()
        .and_then(|cache| cache.lock().ok())
        .and_then(|cache| cache.get(&paths.state_file).cloned())
}

pub(crate) fn try_read_state(paths: &Paths) -> Result<ManagerStateFile, String> {
    let _guard = STATE_FILE_LOCK
        .lock()
        .map_err(|_| "Application state lock is poisoned".to_string())?;
    read_state_unlocked(paths)
}

pub(crate) fn read_state(paths: &Paths) -> ManagerStateFile {
    match try_read_state(paths) {
        Ok(state) => state,
        Err(error) => {
            eprintln!("failed to read application state; using the last valid snapshot: {error}");
            cached_state(paths).unwrap_or_default()
        }
    }
}

fn write_state_unlocked(paths: &Paths, requested: &ManagerStateFile) -> Result<(), String> {
    let state_file_exists = paths.state_file.exists();
    let current = read_state_unlocked(paths)?;
    let mut state = requested.clone();
    if state_file_exists && !state.local_proxy_lan_api_keys_changed {
        state.local_proxy_lan_api_key = current.local_proxy_lan_api_key.clone();
        state.local_proxy_lan_api_keys = current.local_proxy_lan_api_keys.clone();
    }
    state.local_proxy_lan_api_keys_changed = false;
    if state_file_exists && !state.auto_reset_settings_changed {
        state.auto_reset = current.auto_reset.clone();
    }
    state.auto_reset_settings_changed = false;
    match state.concurrent_routing_change_reason.take() {
        Some(reason)
            if current.concurrent_account_routing_enabled != state.concurrent_account_routing_enabled
                || current.concurrent_account_group != state.concurrent_account_group =>
        {
            eprintln!(
                "concurrent account routing changed: old={}, new={}, reason={reason}",
                current.concurrent_account_routing_enabled,
                state.concurrent_account_routing_enabled
            );
        }
        Some(_) => {}
        None if state_file_exists => {
            state.concurrent_account_routing_enabled =
                current.concurrent_account_routing_enabled;
            state.concurrent_account_group = current.concurrent_account_group;
        }
        None => {}
    }
    let value = serde_json::to_value(&state).map_err(|error| error.to_string())?;
    write_json_atomic(&paths.state_file, &value)?;
    cache_state(paths, &state);
    Ok(())
}

pub(crate) fn write_state(paths: &Paths, state: &ManagerStateFile) -> Result<(), String> {
    let _guard = STATE_FILE_LOCK
        .lock()
        .map_err(|_| "Application state lock is poisoned".to_string())?;
    write_state_unlocked(paths, state)
}

pub(crate) fn update_state<T>(
    paths: &Paths,
    update: impl FnOnce(&mut ManagerStateFile) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = STATE_FILE_LOCK
        .lock()
        .map_err(|_| "Application state lock is poisoned".to_string())?;
    let mut state = read_state_unlocked(paths)?;
    let result = update(&mut state)?;
    write_state_unlocked(paths, &state)?;
    Ok(result)
}

pub(crate) fn change_concurrent_account_routing(
    state: &mut ManagerStateFile,
    enabled: bool,
    reason: &str,
) {
    state.concurrent_account_routing_enabled = enabled;
    state.concurrent_routing_change_reason = Some(reason.to_string());
}

pub(crate) fn app_settings_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("settings.json"))
}

fn read_base_app_settings(path: &Path) -> AppSettings {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn read_app_settings<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<AppSettings, String> {
    let path = app_settings_path(app)?;
    let mut settings = read_base_app_settings(&path);
    model_context_settings::apply_saved_context_settings(&path, &mut settings)?;
    language_settings::apply_saved_language(&path, &mut settings);
    settings.non_proxy_enhancements_enabled = crate::client_integration::read_preference(&path)?;
    merge_shared_group_catalogs(&mut settings);
    Ok(settings)
}

fn merge_shared_group_catalogs(settings: &mut AppSettings) {
    let mut groups = Vec::new();
    for group in settings.provider_groups.iter().chain(&settings.account_groups) {
        let group = group.trim().to_string();
        if !group.is_empty() && !groups.contains(&group) {
            groups.push(group);
        }
    }
    settings.provider_groups.clone_from(&groups);
    settings.account_groups = groups;
}

static APP_SETTINGS_WRITE_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn write_app_settings<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &AppSettings,
) -> Result<(), String> {
    let _guard = APP_SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|_| "Application settings are unavailable".to_string())?;
    let path = app_settings_path(app)?;
    let mut value = serde_json::to_value(settings).map_err(|error| error.to_string())?;
    // Only the dedicated setter may authorize quota spending. Stale snapshots from
    // unrelated preference changes must not re-enable (or disable) synchronization.
    // Reading only the base file keeps invalid, unrelated sidecars from blocking writes.
    value["quotaWindowSyncEnabled"] =
        serde_json::json!(read_base_app_settings(&path).quota_window_sync_enabled);
    write_json_atomic(&path, &value)?;
    crate::cloud::remember_push_routing(app, settings);
    Ok(())
}

fn migrate_upstream_429_retry_timeout(settings: &mut AppSettings) -> bool {
    const LEGACY_UPSTREAM_429_RETRY_TIMEOUT_SECONDS: u64 = 300;

    if settings.upstream_429_retry_timeout_migrated {
        return false;
    }
    if settings.upstream_429_retry_timeout_seconds == LEGACY_UPSTREAM_429_RETRY_TIMEOUT_SECONDS {
        settings.upstream_429_retry_timeout_seconds =
            crate::models::DEFAULT_UPSTREAM_429_RETRY_TIMEOUT_SECONDS;
    }
    // Mark custom values too, so later user edits can never trigger this migration.
    settings.upstream_429_retry_timeout_migrated = true;
    true
}

fn migrate_sse_idle_timeout(settings: &mut AppSettings) -> bool {
    const LEGACY_SSE_IDLE_TIMEOUT_SECONDS: u64 = 120;
    if settings.sse_idle_timeout_migrated {
        return false;
    }
    if settings.sse_idle_timeout.timeout_seconds == LEGACY_SSE_IDLE_TIMEOUT_SECONDS {
        settings.sse_idle_timeout.timeout_seconds =
            crate::models::SseIdleTimeoutSettings::default().timeout_seconds;
    }
    // Later edits, including a custom 120 seconds, must not be migrated again.
    settings.sse_idle_timeout_migrated = true;
    true
}

fn apply_app_settings_version_migration(settings: &mut AppSettings, current_version: &str) -> bool {
    let mut changed = migrate_upstream_429_retry_timeout(settings);
    changed |= migrate_sse_idle_timeout(settings);
    if settings.codex_homes.is_empty() {
        if let Some(path) = settings.codex_home.as_deref().filter(|path| !path.trim().is_empty()) {
            settings.codex_homes.push(crate::models::CodexHomeEntry {
                id: uuid::Uuid::new_v4().to_string(),
                path: path.trim().to_string(),
                enabled: true,
            });
            changed = true;
        }
    }
    if settings.last_started_version.as_deref() == Some(current_version) {
        return changed;
    }
    if settings
        .cloud_base_url
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        settings.cloud_base_url = Some(DEFAULT_CLOUD_BASE_URL.to_string());
    }
    settings.last_started_version = Some(current_version.to_string());
    true
}

pub(crate) fn migrate_app_settings_for_version<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    model_context_settings::migrate_legacy_context_settings(app)?;
    let mut settings = read_app_settings(app)?;
    let current_version = app.package_info().version.to_string();
    let mut changed = apply_app_settings_version_migration(&mut settings, &current_version);
    let mut backup_owner = settings
        .codex_homes
        .iter()
        .find(|home| home.enabled)
        .map(|home| home.id.clone())
        .unwrap_or_else(|| crate::codex_home::DEFAULT_CODEX_HOME_ID.to_string());
    changed |= crate::codex_home::ensure_default_entry(
        &mut settings.codex_homes,
        &crate::codex_home::resolve_default()?,
    );
    changed |= crate::codex_home::ensure_gui_entry(
        &mut settings.codex_homes, &crate::codex_home::gui_home(app)?,
    );
    if !settings.codex_homes.iter().any(|home| home.id == backup_owner) {
        backup_owner = crate::codex_home::DEFAULT_CODEX_HOME_ID.to_string();
    }
    if changed {
        settings.codex_home = settings
            .codex_homes
            .iter()
            .find(|home| home.enabled)
            .map(|home| home.path.clone());
        write_app_settings(app, &settings)?;
    }
    migrate_legacy_config_backup(app, &backup_owner)
}

fn migrate_legacy_config_backup<R: Runtime>(
    app: &tauri::AppHandle<R>,
    backup_owner: &str,
) -> Result<(), String> {
    if backup_owner.is_empty()
        || backup_owner.len() > 64
        || !backup_owner
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
    {
        return Ok(());
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    let source = app_data.join("config-before-provider.toml");
    if !source.exists() {
        return Ok(());
    }
    let target = app_data
        .join("config-backups")
        .join(format!("{backup_owner}.toml"));
    if target.exists() {
        return Ok(());
    }
    fs::create_dir_all(target.parent().unwrap_or(&app_data))
        .map_err(|error| format!("无法创建 Codex 配置备份目录：{error}"))?;
    fs::rename(&source, &target).map_err(|error| format!("无法迁移 Codex 配置备份：{error}"))
}

fn should_activate_import(
    state: &ManagerStateFile,
    activate: bool,
    current_auth_exists: bool,
) -> bool {
    activate
        || (!current_auth_exists
            && state.active_account_id.is_none()
            && state.active_provider_id.is_none()
            && state.active_provider_group.is_none())
}

fn should_sync_current_as_active(
    state: &ManagerStateFile,
    id: &str,
    agent_identity: bool,
    proxy_running: bool,
) -> bool {
    state.active_provider_id.is_none()
        && state.active_provider_group.is_none()
        && !state.local_proxy_enabled
        && !proxy_running
        && state.active_account_id.as_deref() != Some(id)
        && !agent_identity
}

pub(crate) fn import_value<R: Runtime>(
    app: &tauri::AppHandle<R>,
    mut auth: Value,
    activate: bool,
) -> Result<String, String> {
    canonicalize_chatgpt_auth(&mut auth)?;
    validate_auth(&auth)?;
    let paths = resolve_paths(app)?;
    let (_, _, _, id) = account_fields(&auth)?;
    let mut state = read_state(&paths);
    let should_activate = should_activate_import(&state, activate, paths.current_auth.exists());
    write_managed_auth_if_changed(&paths, &id, &auth)?;
    if should_activate {
        let proxy_running = crate::local_proxy::is_running();
        let can_activate = if proxy_running {
            true
        } else if crate::auth::is_agent_identity_auth(&auth) {
            false
        } else {
            crate::commands::sync_current_auth_if_client_stopped(&paths, &auth)?
        };
        if can_activate {
            state.active_account_id = Some(id.clone());
            write_state(&paths, &state)?;
            if crate::local_proxy::is_running() {
                crate::providers::apply_local_proxy_config_for_state(app)?;
            }
        }
    }
    Ok(id)
}

pub(crate) fn sync_current_into_store<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    if !paths.current_auth.exists() {
        return Ok(());
    }
    let mut auth = read_json(&paths.current_auth)?;
    let repaired = canonicalize_chatgpt_auth(&mut auth)?;
    validate_auth(&auth)?;
    let id = import_value(app, auth.clone(), false)?;
    if repaired {
        crate::commands::sync_current_auth_if_client_stopped(&paths, &auth)?;
    }
    let mut state = read_state(&paths);
    // In proxy mode auth.json is either absent or belongs to the optional OpenAI
    // login-state account, which is independent from the upstream official account.
    // Do not let startup synchronization turn that credential into the active account.
    if should_sync_current_as_active(
        &state,
        &id,
        crate::auth::is_agent_identity_auth(&auth),
        crate::local_proxy::is_running(),
    ) {
        state.active_account_id = Some(id);
        write_state(&paths, &state)?;
    }
    Ok(())
}

pub(crate) fn load_usage(path: &Path) -> UsageSummary {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn save_usage(path: &Path, usage: &UsageSummary) -> Result<(), String> {
    let value = serde_json::to_value(usage).map_err(|error| error.to_string())?;
    write_json_atomic(path, &value)
}
