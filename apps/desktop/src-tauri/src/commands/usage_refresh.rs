fn is_usage_network_error(error: &str) -> bool {
    if (100..=599).any(|status| error.contains(&format!("HTTP {status}"))) {
        return false;
    }

    let normalized = error.to_ascii_lowercase();
    [
        "error sending request",
        "failed to send request",
        "network",
        "timed out",
        "timeout",
        "connection",
        "dns",
        "tcp",
        "tls",
        "请求超时",
        "连接失败",
        "网络错误",
    ]
    .iter()
    .any(|fragment| normalized.contains(fragment))
}

fn should_disable_account_auto_switch(
    error: &str,
    auto_disable_enabled: bool,
    status_codes: &[u16],
) -> bool {
    // Usage and token-refresh failures include their upstream HTTP status in the error.
    // Only statuses selected by the user are eligible for automatic exclusion. Network errors,
    // timeouts, unmatched HTTP responses, and parsing failures always remain retryable.
    auto_disable_enabled
        && status_codes
            .iter()
            .any(|status| error.contains(&format!("HTTP {status}")))
}

pub(crate) fn try_refresh_usage_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<UsageSummary, String> {
    let refresh_started_at = std::time::Instant::now();
    let paths = resolve_paths(app)?;
    let mut auth = load_auth_for_request(app, &paths, id)?;
    let client = api_client()?;
    refresh_auth_if_needed(&client, &mut auth, &paths, id)?;

    let response = if is_agent_identity_auth(&auth.value) {
        if agent_identity::ensure_task(&client, &mut auth.value)? {
            auth.persist(&paths, id)?;
        }
        let response = agent_identity::usage_request(&client, &auth.value)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            let status = response.status();
            let body = response
                .text()
                .map_err(|error| format!("读取 Agent Identity 鉴权失败响应失败：{error}"))?;
            if !agent_identity::is_invalid_task_response(status, &body) {
                return Err(format!("Codex 用量接口返回 HTTP {status}"));
            }
            agent_identity::register_task(&client, &mut auth.value)?;
            auth.persist(&paths, id)?;
            agent_identity::usage_request(&client, &auth.value)?
        } else {
            response
        }
    } else {
        let mut response = usage_request(&client, &auth.value)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            auth.refresh(&client, &paths, id)?;
            response = usage_request(&client, &auth.value)?;
        }
        response
    };

    if !response.status().is_success() {
        return Err(format!("Codex 用量接口返回 HTTP {}", response.status()));
    }

    let payload: Value = response
        .json()
        .map_err(|error| format!("解析用量响应失败：{error}"))?;
    let mut usage = parse_usage(&payload);
    usage.api_expires_at = subscription_active_until(&auth.value);
    let previous = load_usage(&usage_path(&paths, id));
    save_usage(&usage_path(&paths, id), &usage)?;
    crate::quota_window_sync::observe_usage(app, id, &previous, &usage);
    crate::codex_runtime::refresh_usage_summary();
    // History is supplementary: a storage failure must not turn a successful quota refresh
    // into an account error or trigger automatic account exclusion.
    if let Err(error) = crate::account_quota_history::record_usage(&paths, id, &usage) {
        eprintln!("Failed to save account quota history: {error}");
    }
    crate::local_proxy::concurrent_quota::record_usage_refresh(id, refresh_started_at, &usage)?;
    touch_account_field(&paths, id, AccountSyncField::Usage)?;
    auth.persist(&paths, id)?;
    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(app);
    Ok(usage)
}

fn sync_active_auth(paths: &Paths, id: &str, auth: &Value) -> Result<(), String> {
    if !is_active_account(paths, id) {
        return Ok(());
    }

    sync_current_auth_if_client_stopped(paths, auth)?;
    Ok(())
}

/// Synchronize the startup credential only when no ChatGPT/Codex process can be observing it.
/// A failed process check is treated as "running" so background work never risks a hot write.
pub(crate) fn sync_current_auth_if_client_stopped(
    paths: &Paths,
    auth: &Value,
) -> Result<bool, String> {
    let Ok(_switch_guard) = account_switch_lock().lock() else {
        return Ok(false);
    };
    if matches!(read_json(&paths.current_auth), Ok(current) if current == *auth) {
        return Ok(true);
    }
    let client_running = chatgpt_or_codex_is_running().unwrap_or(true);
    sync_current_auth_with_client_state(paths, auth, client_running)
}

fn sync_current_auth_with_client_state(
    paths: &Paths,
    auth: &Value,
    client_running: bool,
) -> Result<bool, String> {
    if client_running {
        return Ok(false);
    }
    for path in crate::codex_home::replicated_paths(&paths.current_auth) {
        write_json_if_changed(&path, auth)?;
    }
    Ok(true)
}
