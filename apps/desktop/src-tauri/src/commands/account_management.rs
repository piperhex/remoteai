#[tauri::command]
pub(crate) async fn delete_account<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_account_blocking(app, id))
        .await
        .map_err(|_| "Unable to delete the account. Please try again.".to_string())?
}

fn delete_account_blocking<R: Runtime>(app: tauri::AppHandle<R>, id: String) -> Result<(), String> {
    if crate::claude_accounts::is_claude_id(&id) {
        return crate::claude_accounts::delete_blocking(&app, id);
    }
    let paths = resolve_paths(&app)?;
    let current_state = read_state(&paths);
    if current_state.active_account_id.as_deref() == Some(&id) {
        return Err("不能删除当前正在使用的账户，请先切换到其他账户".to_string());
    }
    if current_state.local_proxy_openai_auth_account_id.as_deref() == Some(&id) {
        return Err(
            "Cannot delete the OpenAI login account selected by the local proxy. Clear the proxy login selection first."
                .to_string(),
        );
    }
    let target = account_dir(&paths, &id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|error| format!("删除账户失败：{error}"))?;
    }
    crate::aggregate_api::remove_provider_membership(
        &paths,
        &format!("{}{id}", crate::aggregate_api::ACCOUNT_MEMBER_PREFIX),
    )?;
    crate::aggregate_api::refresh_targets(&app, &paths)?;
    app.emit("aggregate-apis-changed", ()).map_err(|error| error.to_string())?;
    set_account_auto_switch_enabled_for_paths(&paths, &id, true)?;
    let cleared_concurrent_group = clear_empty_concurrent_account_group(&paths)?;
    let mut state = read_state(&paths);
    let mut cleared_image_model = state.image_generation_account_id.as_deref() == Some(&id);
    if cleared_image_model {
        state.image_generation_account_id = None;
    }
    if target_uses_official_account(state.image_input_target.as_ref(), &id) {
        state.image_input_target = None;
        cleared_image_model = true;
    }
    if target_uses_official_account(state.image_output_target.as_ref(), &id) {
        state.image_output_target = None;
        cleared_image_model = true;
    }
    if cleared_image_model {
        write_state(&paths, &state)?;
    }
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    if cleared_image_model || cleared_concurrent_group {
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
    }
    crate::system_tray::refresh_menu(&app);
    Ok(())
}

fn target_uses_official_account(target: Option<&ImageModelTarget>, account_id: &str) -> bool {
    matches!(
        target,
        Some(ImageModelTarget::Official { account_id: selected }) if selected == account_id
    )
}

#[tauri::command]
pub(crate) async fn restart_chatgpt<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    crate::client_lifecycle::run(move || restart_chatgpt_blocking(app)).await
}

pub(crate) fn restart_chatgpt_blocking<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    // Keep a manual account switch and a restart as one operation.  In proxy mode the
    // switch deliberately leaves auth.json alone while Codex is running, so the
    // restarted process must receive the selected credential before it starts.
    let _switch_guard = crate::client_lifecycle::try_lock(account_switch_lock())
        .map_err(|error| error.to_string())?;
    restart_chatgpt_unlocked(&app)
}

pub(crate) fn restart_chatgpt_unlocked<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let launch_target = refresh_and_get_chatgpt_launch_target(app)?;
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let prepared = crate::codex_runtime::prepare_managed_session(
        launch_target.as_ref().map(|target| target.executable.as_path()),
    )?;
    stop_chatgpt_processes()?;
    wait_for_chatgpt_processes_to_exit(Duration::from_secs(10))?;
    sync_active_proxy_auth_for_restart(app)?;
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        prepared.restart()?;
        refresh_local_codex_path_after_restart(app);
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    restart_chatgpt_from_target(app, launch_target.as_ref())
}

#[tauri::command]
pub(crate) async fn launch_chatgpt<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<bool, String> {
    crate::client_lifecycle::run(move || launch_chatgpt_blocking(app)).await
}

fn launch_chatgpt_blocking<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let _switch_guard = crate::client_lifecycle::try_lock(account_switch_lock())
        .map_err(|error| error.to_string())?;
    if chatgpt_or_codex_is_running()? {
        return Ok(false);
    }

    let launch_target = refresh_and_get_chatgpt_launch_target(&app)?;
    sync_active_proxy_auth_for_restart(&app)?;
    restart_chatgpt_from_target(&app, launch_target.as_ref())?;
    Ok(true)
}

/// Shared launch entry for account, proxy, login and conversation operations.
/// Callers performing an account change already hold the account-switch lock.
pub(crate) fn restart_chatgpt_from_target<R: Runtime>(
    app: &tauri::AppHandle<R>,
    launch_target: Option<&ChatGptLaunchTarget>,
) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    crate::codex_runtime::restart_managed_session(
        launch_target.map(|target| target.executable.as_path()),
    )?;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    start_unmanaged_chatgpt(launch_target)?;
    refresh_local_codex_path_after_restart(app);
    Ok(())
}

#[cfg(target_os = "windows")]
fn refresh_local_codex_path_after_restart<R: Runtime>(app: &tauri::AppHandle<R>) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if discover_running_chatgpt_or_codex_path().is_some() {
            refresh_local_codex_path(app);
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(not(target_os = "windows"))]
fn refresh_local_codex_path_after_restart<R: Runtime>(_app: &tauri::AppHandle<R>) {}

fn sync_active_proxy_auth_for_restart<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    if !crate::local_proxy::is_running() {
        return Ok(());
    }

    crate::storage::resolve_enabled_paths(app)?
        .iter()
        .try_for_each(crate::providers::sync_local_proxy_openai_auth)
}
