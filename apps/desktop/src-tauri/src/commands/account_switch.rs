#[tauri::command]
pub(crate) async fn switch_account<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || switch_account_blocking(app, id))
        .await
        .map_err(|error| format!("Account switch task failed: {error}"))?
}

/// Blocking account switch that must run off the UI thread. The switch spawns
/// PowerShell subprocesses and performs file I/O, so it is invoked through
/// `switch_account` on the desktop and directly from proxy request threads.
pub(crate) fn switch_account_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    switch_account_blocking_with_reason(app, id, AccountSwitchReason::Manual)
}

pub(crate) fn switch_account_automatically_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    switch_account_blocking_with_reason(app, id, AccountSwitchReason::Automatic)
}

fn switch_account_blocking_with_reason<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    reason: AccountSwitchReason,
) -> Result<(), String> {
    if crate::claude_accounts::is_claude_id(&id) {
        return crate::claude_accounts::switch_blocking(&app, id);
    }
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    refresh_local_codex_path(&app);
    switch_account_unlocked_with_options(
        &app,
        &id,
        AccountSwitchOptions {
            preserve_previous: true,
            reason,
        },
    )
}

/// Switch an official account without ever exposing a running ChatGPT/Codex
/// process to the replacement credential.  The local proxy owns the active
/// credential while it is running, so proxy switches intentionally remain
/// hot and do not restart ChatGPT.
#[tauri::command]
pub(crate) async fn switch_account_and_restart_chatgpt<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        switch_account_and_restart_chatgpt_blocking(app, id)
    })
    .await
    .map_err(|error| format!("Account switch task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn deactivate_account_and_restart_chatgpt<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        deactivate_account_and_restart_chatgpt_blocking(app)
    })
    .await
    .map_err(|error| format!("Account deactivation task failed: {error}"))?
}

fn deactivate_account_and_restart_chatgpt_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    refresh_local_codex_path(&app);

    if !crate::claude_code::should_write_codex_for_app(&app)? {
        return deactivate_account_unlocked(&app, crate::local_proxy::is_running()).map(|_| ());
    }

    let proxy_running = crate::local_proxy::is_running();
    let client_was_running = !proxy_running && chatgpt_or_codex_is_running()?;
    let launch_target = client_was_running
        .then(|| refresh_and_get_chatgpt_launch_target(&app))
        .transpose()?
        .flatten();
    if client_was_running {
        stop_chatgpt_processes()?;
        wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }

    let deactivate_result = deactivate_account_unlocked(&app, proxy_running);
    if !client_was_running {
        return deactivate_result.map(|_| ());
    }

    let restart_result = restart_chatgpt_from_target(&app, launch_target.as_ref());
    match (deactivate_result, restart_result) {
        (Ok(_), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(format!(
            concat!(
                "Official account was deactivated, but ChatGPT/Codex could not be restarted ",
                "({error}). Please start ChatGPT or Codex manually."
            ),
            error = error
        )),
        (Err(deactivate_error), Err(restart_error)) => Err(format!(
            concat!(
                "Official account could not be deactivated ({deactivate_error}), ",
                "and ChatGPT/Codex could not be restarted ({restart_error})."
            ),
            deactivate_error = deactivate_error,
            restart_error = restart_error
        )),
    }
}

fn deactivate_account_unlocked<R: Runtime>(
    app: &tauri::AppHandle<R>,
    proxy_running: bool,
) -> Result<Option<String>, String> {
    let paths = resolve_paths(app)?;
    let mut original_state = try_read_state(&paths)?;
    let previous_account_id = original_state.active_account_id.clone();
    crate::conversation_hub::mark_threads_before_account_switch(
        &paths,
        &mut original_state,
        previous_account_id.as_deref(),
    )?;
    let Some(account_id) = original_state.active_account_id.clone() else {
        return Ok(None);
    };
    crate::providers::preserve_refreshed_auth(&paths, &account_id);
    let mut state = original_state.clone();
    state.active_account_id = None;
    change_concurrent_account_routing(&mut state, false, "account deactivation");
    write_state(&paths, &state)?;

    let write_codex = crate::claude_code::should_write_codex_for_app(app)?;
    let auth_result = if !write_codex {
        Ok(())
    } else if proxy_running {
        resolve_enabled_paths(app)?.iter().try_for_each(|target| {
            crate::providers::sync_local_proxy_openai_auth(target)
        })
    } else {
        resolve_enabled_paths(app)?
            .iter()
            .try_for_each(remove_current_auth)
    };
    if let Err(error) = auth_result {
        restore_account_switch_state(&paths, original_state, "account deactivation rollback");
        return Err(error);
    }

    touch_account_field(&paths, &account_id, AccountSyncField::Active)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    if proxy_running && write_codex {
        crate::providers::refresh_official_codex_models();
    }
    if crate::client_integration::enabled_for(proxy_running) {
        crate::claude_code::sync_after_switch(app)?;
    }
    crate::system_tray::refresh_menu(app);
    Ok(Some(account_id))
}

pub(crate) fn switch_account_and_restart_chatgpt_blocking<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    if crate::claude_accounts::is_claude_id(&id) {
        return crate::claude_accounts::switch_blocking(&app, id);
    }
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;

    // Refresh the launch hint for every account switch, including hot proxy
    // switches where no restart is needed.
    refresh_local_codex_path(&app);
    if !crate::claude_code::should_write_codex_for_app(&app)? {
        return switch_account_unlocked(&app, &id);
    }
    if crate::local_proxy::is_running() {
        return switch_account_unlocked(&app, &id);
    }

    // Validate the target before stopping ChatGPT so a malformed managed
    // credential cannot leave the user with a closed application.
    let paths = resolve_paths(&app)?;
    load_validated_managed_auth(&paths, &id)?;

    let launch_target = refresh_and_get_chatgpt_launch_target(&app)?;
    if chatgpt_or_codex_is_running()? {
        stop_chatgpt_processes()?;
        wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }

    // When no client is running, write the replacement credential immediately.
    // When one is running, the preceding shutdown gives the same guarantee.
    switch_account_unlocked(&app, &id)?;
    restart_chatgpt_from_target(&app, launch_target.as_ref()).map_err(|error| {
        format!(
            "账户已切换，但无法自动启动 ChatGPT/Codex（{error}）。请手动启动 ChatGPT 或 Codex。"
        )
    })
}

/// Reapplies a refreshed login only when that account is still active. Unlike a manual switch,
/// this does not launch ChatGPT/Codex when it was not already running.
pub(crate) fn reapply_active_account_after_login<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<bool, String> {
    let _switch_guard = account_switch_lock()
        .lock()
        .map_err(|_| "Account switch lock is poisoned".to_string())?;
    refresh_local_codex_path(&app);
    let paths = resolve_paths(&app)?;
    if try_read_state(&paths)?.active_account_id.as_deref() != Some(&id) {
        return Ok(false);
    }
    let write_codex = crate::claude_code::should_write_codex_for_app(&app)?;
    if !write_codex || crate::local_proxy::is_running() {
        switch_account_unlocked_with_options(
            &app,
            &id,
            AccountSwitchOptions::credential_refresh(),
        )?;
        return Ok(true);
    }
    let client_was_running = chatgpt_or_codex_is_running()?;
    let launch_target = client_was_running
        .then(|| refresh_and_get_chatgpt_launch_target(&app))
        .transpose()?
        .flatten();
    if client_was_running {
        stop_chatgpt_processes()?;
        wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    }
    switch_account_unlocked_with_options(
        &app,
        &id,
        AccountSwitchOptions::credential_refresh(),
    )?;
    if client_was_running {
        restart_chatgpt_from_target(&app, launch_target.as_ref())?;
    }
    Ok(true)
}

fn switch_account_unlocked<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) -> Result<(), String> {
    switch_account_unlocked_with_options(app, id, AccountSwitchOptions::manual())
}

fn switch_account_unlocked_with_options<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    options: AccountSwitchOptions,
) -> Result<(), String> {
    let proxy_running = crate::local_proxy::is_running();
    let paths = resolve_paths(app)?;
    let selected = load_validated_managed_auth(&paths, id)?;
    ensure_account_switch_allowed(&selected, proxy_running)?;
    let mut original_state = try_read_state(&paths)?;
    let previous_account_id = original_state.active_account_id.clone();
    crate::conversation_hub::mark_threads_before_account_switch(
        &paths,
        &mut original_state,
        previous_account_id.as_deref(),
    )?;
    if options.preserve_previous {
        if let Some(previous_account_id) = original_state.active_account_id.as_deref() {
            crate::providers::preserve_refreshed_auth(&paths, previous_account_id);
        }
    }
    apply_account_switch(
        app,
        id,
        AccountSwitchContext {
            proxy_running,
            paths,
            selected,
            original_state,
            reason: options.reason,
        },
    )
}

fn ensure_account_switch_allowed(auth: &Value, proxy_running: bool) -> Result<(), String> {
    if !proxy_running && is_agent_identity_auth(auth) {
        return Err(
            "Agent Identity 账号只能在本地代理模式下切换。请先启动本地代理，再切换到该账号"
                .to_string(),
        );
    }
    Ok(())
}

pub(crate) fn load_validated_managed_auth(paths: &Paths, id: &str) -> Result<Value, String> {
    let mut auth = read_json(&managed_auth_path(paths, id))?;
    if canonicalize_chatgpt_auth(&mut auth)? {
        write_managed_auth_if_changed(paths, id, &auth)?;
    }
    validate_auth(&auth)?;
    Ok(auth)
}

pub(crate) fn write_managed_auth_to_current(paths: &Paths, id: &str) -> Result<(), String> {
    let auth = load_validated_managed_auth(paths, id)?;
    for path in crate::codex_home::replicated_paths(&paths.current_auth) {
        write_json_atomic(&path, &auth)?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn set_account_auto_switch_enabled<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    let paths = resolve_paths(&app)?;
    if !managed_auth_path(&paths, &id).exists() {
        return Err("Account does not exist".to_string());
    }
    set_account_auto_switch_enabled_for_paths(&paths, &id, enabled)?;
    let cleared_concurrent_group = clear_empty_concurrent_account_group(&paths)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    if cleared_concurrent_group {
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn remove_current_auth(paths: &Paths) -> Result<(), String> {
    match fs::remove_file(&paths.current_auth) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Failed to remove current auth.json: {error}")),
    }
}

#[tauri::command]
pub(crate) fn set_auto_disable_status_codes<R: Runtime>(
    app: tauri::AppHandle<R>,
    mut status_codes: Vec<u16>,
) -> Result<AppSettings, String> {
    if status_codes
        .iter()
        .any(|status| !(100..=599).contains(status))
    {
        return Err("automatic disable status codes must be between 100 and 599".to_string());
    }
    status_codes.sort_unstable();
    status_codes.dedup();

    let mut settings = read_app_settings(&app)?;
    settings.auto_disable_status_codes = status_codes;
    write_app_settings(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn set_account_auto_switch_priority<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
    priority: i32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = resolve_paths(&app)?;
        if !managed_auth_path(&paths, &id).exists() {
            return Err("Account does not exist".to_string());
        }
        let path = auto_switch_priority_path(&paths, &id);
        if load_auto_switch_priority(&path) != priority || !path.exists() {
            save_auto_switch_priority(&path, priority)?;
            touch_account_field(&paths, &id, AccountSyncField::AutoSwitchPriority)?;
        }
        app.emit("accounts-changed", ())
            .map_err(|error| error.to_string())?;
        Ok(())
    })
    .await
    .map_err(|error| format!("Account priority update task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_account_auto_switch_threshold<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
    threshold: f64,
) -> Result<(), String> {
    if !threshold.is_finite() || !(0.0..=100.0).contains(&threshold) {
        return Err("Auto-switch threshold must be between 0 and 100".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let paths = resolve_paths(&app)?;
        if !managed_auth_path(&paths, &id).exists() {
            return Err("Account does not exist".to_string());
        }
        let path = auto_switch_threshold_path(&paths, &id);
        if load_auto_switch_threshold(&path) != threshold || !path.exists() {
            save_auto_switch_threshold(&path, threshold)?;
            touch_account_field(&paths, &id, AccountSyncField::AutoSwitchThreshold)?;
        }
        app.emit("accounts-changed", ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Account threshold task failed: {error}"))?
}

fn update_disabled_account_ids(state: &mut ManagerStateFile, id: &str, enabled: bool) -> bool {
    let was_disabled = state
        .disabled_account_ids
        .iter()
        .any(|account_id| account_id == id);
    let should_be_disabled = !enabled;
    if enabled {
        state
            .disabled_account_ids
            .retain(|account_id| account_id != id);
    } else if !was_disabled {
        state.disabled_account_ids.push(id.to_string());
        state.disabled_account_ids.sort();
    }
    was_disabled != should_be_disabled
}

pub(crate) fn set_account_auto_switch_enabled_for_paths(
    paths: &Paths,
    id: &str,
    enabled: bool,
) -> Result<bool, String> {
    let _guard = account_auto_switch_state_lock()
        .lock()
        .map_err(|_| "Account auto-switch state lock is poisoned".to_string())?;
    let mut state = try_read_state(paths)?;
    let changed = update_disabled_account_ids(&mut state, id, enabled);
    if changed {
        write_state(paths, &state)?;
    }
    Ok(changed)
}
