#[derive(Clone, Copy)]
enum AccountSwitchReason {
    Manual,
    Automatic,
    CredentialRefresh,
}

impl AccountSwitchReason {
    fn disables_concurrent_routing(self) -> bool {
        matches!(self, Self::Manual)
    }

    fn refreshes_official_model_catalog(self) -> bool {
        !matches!(self, Self::CredentialRefresh)
    }

    fn syncs_sidebar_membership(self) -> bool {
        !matches!(self, Self::CredentialRefresh)
    }
}

#[derive(Clone, Copy)]
struct AccountSwitchOptions {
    preserve_previous: bool,
    reason: AccountSwitchReason,
}

impl AccountSwitchOptions {
    fn manual() -> Self {
        Self {
            preserve_previous: true,
            reason: AccountSwitchReason::Manual,
        }
    }

    fn credential_refresh() -> Self {
        Self {
            preserve_previous: false,
            reason: AccountSwitchReason::CredentialRefresh,
        }
    }
}

struct AccountSwitchContext {
    proxy_running: bool,
    paths: Paths,
    selected: Value,
    original_state: ManagerStateFile,
    reason: AccountSwitchReason,
}

fn apply_account_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    context: AccountSwitchContext,
) -> Result<(), String> {
    let AccountSwitchContext {
        proxy_running,
        paths,
        selected,
        original_state,
        reason,
    } = context;
    let state = official_account_state(&original_state, id, reason);
    let write_codex = crate::claude_code::should_write_codex_for_app(app)?;
    let enhancements_enabled = crate::client_integration::enabled_for(proxy_running);
    if write_codex && !proxy_running && reason.syncs_sidebar_membership() {
        sync_offline_sidebar_membership(app, &selected)?;
    }
    if !write_codex {
        write_state(&paths, &state)?;
    } else if proxy_running {
        write_proxy_account_state(app, &paths, &state, &original_state)?;
    } else {
        for target in resolve_enabled_paths(app)? {
            write_direct_account_auth(&target, &selected, enhancements_enabled)?;
        }
        write_state(&paths, &state)?;
    }
    finish_account_switch(
        app,
        &paths,
        id,
        AccountSwitchCompletion {
            proxy_running,
            write_codex,
            refresh_model_catalog: enhancements_enabled && reason.refreshes_official_model_catalog(),
        },
    )
}

fn write_direct_account_auth(paths: &Paths, auth: &Value, enhancements_enabled: bool) -> Result<(), String> {
    write_json_atomic(&paths.current_auth, auth)?;
    if enhancements_enabled {
        crate::providers::restore_official_config(paths)?;
    }
    Ok(())
}

fn sync_offline_sidebar_membership<R: Runtime>(
    app: &tauri::AppHandle<R>,
    selected: &Value,
) -> Result<(), String> {
    let settings = match read_app_settings(app) {
        Ok(settings) => settings,
        Err(_) => {
            eprintln!("sidebar_sync_settings_unavailable");
            return Ok(());
        }
    };
    if !settings.codex_sidebar_sync_enabled {
        return Ok(());
    }
    // A running desktop retains these preferences in memory and would overwrite an offline merge.
    // Hot proxy switches keep the desktop identity and do not need this synchronization.
    if chatgpt_or_codex_is_running()? {
        eprintln!("sidebar_sync_skipped_desktop_running");
        return Ok(());
    }
    for target in resolve_enabled_paths(app)? {
        let previous = match read_json(&target.current_auth) {
            Ok(previous) => previous,
            Err(_) => continue,
        };
        if let Err(error) = crate::codex_sidebar::sync(&target.codex_home, &previous, selected) {
            // Optional layout compatibility must not prevent a valid credential switch.
            // Log only the error category, never identifiers, paths or credential contents.
            eprintln!("{error}");
        }
    }
    Ok(())
}

fn official_account_state(
    original: &ManagerStateFile,
    id: &str,
    reason: AccountSwitchReason,
) -> ManagerStateFile {
    let mut state = original.clone();
    state.active_provider_id = None;
    state.active_provider_group = None;
    state.active_account_id = Some(id.to_string());
    if reason.disables_concurrent_routing() {
        change_concurrent_account_routing(&mut state, false, "manual account switch");
    }
    state
}

fn write_proxy_account_state<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &Paths,
    state: &ManagerStateFile,
    original: &ManagerStateFile,
) -> Result<(), String> {
    // Publish the official route before config.toml so reconnects cannot use the old Provider.
    write_state(paths, state)?;
    for target in resolve_enabled_paths(app)? {
        if let Err(error) = crate::providers::write_official_local_proxy_config(&target) {
            restore_account_switch_state(paths, original.clone(), "account switch rollback");
            return Err(error);
        }
        if let Err(error) = crate::providers::sync_local_proxy_openai_auth(&target) {
            restore_account_switch_state(paths, original.clone(), "account switch rollback");
            return Err(error);
        }
    }
    Ok(())
}

fn finish_account_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &Paths,
    id: &str,
    completion: AccountSwitchCompletion,
) -> Result<(), String> {
    touch_account_field(paths, id, AccountSyncField::Active)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    app.emit("providers-changed", ())
        .map_err(|error| error.to_string())?;
    if completion.proxy_running && completion.write_codex {
        crate::providers::refresh_official_codex_models();
    }
    if completion.refresh_model_catalog {
        crate::official_models::refresh_after_account_switch(id);
    }
    if crate::client_integration::enabled_for(completion.proxy_running) {
        crate::claude_code::sync_after_switch(app)?;
    }
    crate::system_tray::refresh_menu(app);
    Ok(())
}

struct AccountSwitchCompletion {
    proxy_running: bool,
    write_codex: bool,
    refresh_model_catalog: bool,
}

fn restore_account_switch_state(paths: &Paths, mut state: ManagerStateFile, reason: &str) {
    let enabled = state.concurrent_account_routing_enabled;
    change_concurrent_account_routing(&mut state, enabled, reason);
    if let Err(error) = write_state(paths, &state) {
        eprintln!("failed to restore account switch state: {error}");
    }
}
