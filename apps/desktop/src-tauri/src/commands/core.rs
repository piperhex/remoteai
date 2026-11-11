#[cfg(unix)]
const CHATGPT_COMMAND: &str = "chatgpt";
const OFFICIAL_CONVERSATION_PROVIDER: &str = "openai";
const LOCAL_PROXY_CONVERSATION_PROVIDER: &str = "codex-switch-local";
#[cfg(unix)]
const LEGACY_CODEX_COMMAND: &str = "codex";
static ACCOUNT_AUTO_SWITCH_STATE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static ACCOUNT_SWITCH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn account_auto_switch_state_lock() -> &'static Mutex<()> {
    ACCOUNT_AUTO_SWITCH_STATE_LOCK.get_or_init(|| Mutex::new(()))
}

pub(crate) fn account_switch_lock() -> &'static Mutex<()> {
    ACCOUNT_SWITCH_LOCK.get_or_init(|| Mutex::new(()))
}

/// Import the externally managed credential only once, when Remote AI starts.
/// Later operations deliberately use the managed account store instead.
pub(crate) fn initialize_local_state<R: Runtime>(app: &tauri::AppHandle<R>) {
    let _ = sync_current_into_store(app);
    refresh_local_codex_path(app);
}

#[derive(Clone)]
pub(crate) struct ChatGptLaunchTarget {
    executable: std::path::PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ManagedFolder {
    CodexHome,
    RemoteAiHome,
    AccountStore,
}

#[tauri::command]
pub(crate) async fn get_app_info<R: Runtime>(app: tauri::AppHandle<R>) -> Result<AppInfo, String> {
    tauri::async_runtime::spawn_blocking(move || app_info_blocking(&app))
        .await
        .map_err(|_| "暂时无法读取应用信息，请稍后重试。".to_string())?
}

fn app_info_blocking<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<AppInfo, String> {
    let paths = resolve_paths(app)?;
    Ok(AppInfo {
        codex_home: paths.codex_home.display().to_string(),
        auth_path: paths.current_auth.display().to_string(),
        config_path: paths.current_config.display().to_string(),
        account_store: paths.accounts.display().to_string(),
        provider_store: paths.providers.display().to_string(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
pub(crate) async fn open_managed_folder<R: Runtime>(
    app: tauri::AppHandle<R>,
    target: ManagedFolder,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || open_managed_folder_blocking(&app, target))
        .await
        .map_err(|_| "暂时无法打开目录，请稍后重试。".to_string())?
}

fn open_managed_folder_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    target: ManagedFolder,
) -> Result<(), String> {
    use tauri::Manager;

    let path = match target {
        ManagedFolder::CodexHome => resolve_paths(app)?.codex_home,
        ManagedFolder::RemoteAiHome => app
            .path()
            .app_data_dir()
            .map_err(|_| "暂时无法找到 RemoteAI Home 目录，请稍后重试。".to_string())?,
        ManagedFolder::AccountStore => resolve_paths(app)?.accounts,
    };
    fs::create_dir_all(&path)
        .map_err(|_| "无法创建目录，请检查文件夹权限后重试。".to_string())?;
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|_| "无法打开目录，请稍后重试。".to_string())
}

pub(crate) fn list_accounts_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<AccountSummary>, String> {
    // 非 ChatGPT 模式或损坏的当前 auth.json 不应阻止管理器打开。
    let paths = resolve_paths(&app)?;
    fs::create_dir_all(&paths.accounts).map_err(|error| format!("创建账户目录失败：{error}"))?;
    let state = read_state(&paths);
    let active_id = state.active_account_id.clone();
    let mut accounts = Vec::new();
    for entry in
        fs::read_dir(&paths.accounts).map_err(|error| format!("读取账户目录失败：{error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        let auth_path = entry.path().join("auth.json");
        if !auth_path.exists() {
            continue;
        }
        let mut auth = read_json(&auth_path)?;
        let repaired = canonicalize_chatgpt_auth(&mut auth)?;
        let (email, auth_plan, account_id, id) = account_fields(&auth)?;
        if repaired {
            write_managed_auth_if_changed(&paths, &id, &auth)?;
        }
        let local_proxy_compatible = true;
        let agent_identity = is_agent_identity_auth(&auth);
        let direct_switch_compatible = !agent_identity;
        let auto_switch_enabled = !state.disabled_account_ids.contains(&id);
        let auto_switch_priority =
            load_auto_switch_priority(&auto_switch_priority_path(&paths, &id));
        let auto_switch_threshold =
            load_auto_switch_threshold(&auto_switch_threshold_path(&paths, &id));
        let mut usage = load_usage(&usage_path(&paths, &id));
        usage.api_expires_at = subscription_active_until(&auth);
        let (official, metadata_editable) = load_official_account_access(&paths, &id);
        let plan = usage
            .plan
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(auth_plan);
        accounts.push(AccountSummary {
            account_source: "codex",
            active: active_id.as_deref() == Some(&id),
            usage,
            group: load_account_group(&account_group_path(&paths, &id)),
            note: load_note(&note_path(&paths, &id)),
            expires_at: load_expiration(&expiration_path(&paths, &id)),
            private_details: load_account_private_details(&account_private_details_path(
                &paths, &id,
            )),
            id,
            email,
            plan,
            account_id,
            auto_switch_enabled,
            auto_switch_priority,
            auto_switch_threshold,
            local_proxy_compatible,
            direct_switch_compatible,
            agent_identity,
            official,
            metadata_editable,
        });
    }
    accounts.extend(crate::claude_accounts::list(&paths)?);
    accounts.sort_by(|left, right| left.email.cmp(&right.email));
    Ok(accounts)
}

#[tauri::command]
pub(crate) async fn list_accounts<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<AccountSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_accounts_blocking(app))
        .await
        .map_err(|error| format!("Account list task failed: {error}"))?
}

#[tauri::command]
pub(crate) fn copy_account_auth_json<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    if id.len() != 24 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Account does not exist".to_string());
    }

    let paths = resolve_paths(&app)?;
    let auth = load_validated_managed_auth(&paths, &id)?;
    let content = serde_json::to_string_pretty(&auth)
        .map_err(|error| format!("Failed to serialize auth.json: {error}"))?;
    app.clipboard()
        .write_text(content)
        .map_err(|error| format!("Failed to copy auth.json: {error}"))
}

#[tauri::command]
pub(crate) fn import_auth_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<String, String> {
    let auth = read_json(Path::new(&path))?;
    let id = import_value(&app, auth, false)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(&app);
    Ok(id)
}

/// Imports a supported account JSON file by detecting standard auth.json,
/// sub2api-data exports, and compatible JSON/JSONL token layouts.
#[tauri::command]
pub(crate) fn import_account_json_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<CompatibleJsonImportResult, String> {
    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取 {} 失败：{error}", path))?;
    import_account_json_text_blocking(app, content)
}

#[tauri::command]
pub(crate) async fn import_account_json_text<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    content: String,
) -> Result<CompatibleJsonImportResult, String> {
    const MAX_ACCOUNT_IMPORT_BYTES: usize = 20 * 1024 * 1024;
    if content.len() > MAX_ACCOUNT_IMPORT_BYTES {
        return Err("导入内容过大，请拆分为小于 20 MB 的文件后重试".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || import_account_json_text_blocking(app, content))
        .await
        .map_err(|error| {
            eprintln!("account text import task failed: {error}");
            "账户导入未完成，请重试".to_string()
        })?
}

fn import_account_json_text_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    content: String,
) -> Result<CompatibleJsonImportResult, String> {
    let content = content.trim_start_matches('\u{feff}').trim();
    if content.is_empty() {
        return Err("导入内容为空".to_string());
    }
    let value = serde_json::from_str::<Value>(content).ok();

    if value.as_ref().is_some_and(is_sub2api_export) {
        let auth_values = parse_sub2api_auth_values(content)?;
        return import_normalized_json_auth_values(&app, &auth_values, normalize_sub2api_auth);
    }

    if value.as_ref().is_some_and(is_valid_auth_json) {
        let id = import_value(&app, value.expect("checked above"), false)?;
        app.emit("accounts-changed", ())
            .map_err(|error| error.to_string())?;
        crate::system_tray::refresh_menu(&app);
        return Ok(CompatibleJsonImportResult {
            imported_ids: vec![id],
            skipped: Vec::new(),
        });
    }

    let auth_values = parse_compatible_json_auth_values(content)?;
    import_normalized_json_auth_values(&app, &auth_values, normalize_compatible_json_auth)
}

fn import_account_json_from_clipboard_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CompatibleJsonImportResult, String> {
    let content = app.clipboard().read_text().map_err(|error| {
        eprintln!("failed to read account JSON from clipboard: {error}");
        "无法读取剪贴板，请复制账号 JSON 后重试".to_string()
    })?;
    import_account_json_text_blocking(app, content)
}

#[tauri::command]
pub(crate) async fn import_account_json_from_clipboard<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<CompatibleJsonImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        import_account_json_from_clipboard_blocking(app)
    })
    .await
    .map_err(|error| {
        eprintln!("clipboard account import task failed: {error}");
        "剪贴板导入未完成，请重试".to_string()
    })?
}

fn is_sub2api_export(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.get("type").and_then(Value::as_str) == Some("sub2api-data") {
        return true;
    }
    object
        .get("accounts")
        .and_then(Value::as_array)
        .is_some_and(|accounts| !accounts.is_empty() && accounts.iter().all(is_sub2api_account))
}

fn is_sub2api_account(value: &Value) -> bool {
    value.get("platform").and_then(Value::as_str) == Some("openai")
        && value.get("type").and_then(Value::as_str) == Some("oauth")
        && value.get("credentials").is_some_and(Value::is_object)
}

fn is_valid_auth_json(value: &Value) -> bool {
    let mut auth = value.clone();
    canonicalize_chatgpt_auth(&mut auth)
        .and_then(|_| validate_auth(&auth))
        .is_ok()
}
