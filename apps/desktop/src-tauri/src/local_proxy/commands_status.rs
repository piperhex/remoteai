pub(crate) fn is_running() -> bool {
    runtime()
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

fn status<R: Runtime>(app: &tauri::AppHandle<R>) -> LocalProxyStatus {
    let (
        auto_switch_on_quota_exhaustion,
        concurrent_account_routing_enabled,
        concurrent_account_group,
        custom_auto_switch_priority_enabled,
        custom_auto_switch_threshold_enabled,
        global_auto_switch_threshold,
        auto_disable_unreachable_accounts,
        system_prompt_filter_enabled,
        system_prompt_filter_rules,
        system_prompt_injection_enabled,
        system_prompt_injection_prompts,
        listen_on_all_interfaces,
        has_lan_api_key,
        image_generation_account_id,
        image_input_target,
        image_output_target,
        openai_auth_account_id,
    ) = resolve_paths(app)
        .map(|paths| {
            let state = read_state(&paths);
            let image_output_target = effective_image_output_target(&state);
            (
                state.auto_switch_on_quota_exhaustion,
                state.concurrent_account_routing_enabled,
                state.concurrent_account_group.clone(),
                state.custom_auto_switch_priority_enabled,
                state.custom_auto_switch_threshold_enabled,
                state.global_auto_switch_threshold,
                state.auto_disable_unreachable_accounts,
                state.system_prompt_filter_enabled,
                state.system_prompt_filter_rules.clone(),
                state.system_prompt_injection_enabled,
                state.system_prompt_injection_prompts.clone(),
                lan_listening_enabled(&state),
                configured_lan_api_key(&state).is_some(),
                state.image_generation_account_id,
                state.image_input_target,
                image_output_target,
                state.local_proxy_openai_auth_account_id,
            )
        })
        .unwrap_or((
            false,
            false,
            None,
            false,
            false,
            0.0,
            false,
            false,
            Vec::new(),
            false,
            Vec::new(),
            false,
            false,
            None,
            None,
            None,
            None,
        ));
    let running = is_running();
    LocalProxyStatus {
        running,
        fast_mode_enabled: running && proxy_service_tier() != ProxyServiceTier::Default,
        fast_mode_available: running
            && resolve_paths(app)
                .is_ok_and(|paths| providers::current_target_supports_fast_mode(&paths)),
        address: proxy_bind_host(listen_on_all_interfaces).to_string(),
        port: LOCAL_PROXY_PORT,
        base_url: LOCAL_PROXY_BASE_URL.to_string(),
        auto_switch_on_quota_exhaustion,
        concurrent_account_routing_enabled,
        concurrent_account_group,
        custom_auto_switch_priority_enabled,
        custom_auto_switch_threshold_enabled,
        global_auto_switch_threshold,
        auto_disable_unreachable_accounts,
        system_prompt_filter_enabled,
        system_prompt_filter_rules,
        system_prompt_injection_enabled,
        system_prompt_injection_prompts,
        listen_on_all_interfaces,
        has_lan_api_key,
        image_generation_account_id,
        image_input_target,
        image_output_target,
        openai_auth_account_id,
    }
}

fn effective_image_output_target(state: &ManagerStateFile) -> Option<ImageModelTarget> {
    state.image_output_target.clone().or_else(|| {
        state
            .image_generation_account_id
            .as_ref()
            .map(|account_id| ImageModelTarget::Official {
                account_id: account_id.clone(),
            })
    })
}

#[tauri::command]
pub(crate) async fn get_local_proxy_status<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(status(&app)))
        .await
        .map_err(|error| format!("Local proxy status task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_local_proxy_fast_mode<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LocalProxyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !is_running() {
            return Err("Start the local proxy before changing request speed".to_string());
        }
        let paths = resolve_paths(&app)?;
        if enabled && !providers::current_target_supports_fast_mode(&paths) {
            return Err("Fast mode is not available for the current provider".to_string());
        }
        let tier = if enabled { "priority" } else { "default" };
        if !set_proxy_service_tier_by_name(tier) {
            return Err("The selected request speed is not supported".to_string());
        }
        providers::refresh_codex_models_for_current_target(&paths);
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
        Ok(status(&app))
    })
    .await
    .map_err(|error| format!("Request speed task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_gpt_5_6_sol_context_window<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    context_window: u64,
) -> Result<AppSettings, String> {
    validate_gpt_5_6_sol_context_window(context_window)?;
    tauri::async_runtime::spawn_blocking(move || {
        set_gpt_5_6_sol_context_window_blocking(&app, context_window)
    })
    .await
    .map_err(|error| format!("Model context window task failed: {error}"))?
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfficialModelContextSettings {
    pub(crate) global_context_window: u64,
    pub(crate) model_context_windows: std::collections::BTreeMap<String, u64>,
    pub(crate) models: Vec<String>,
}

fn official_context_settings<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: AppSettings,
) -> OfficialModelContextSettings {
    let mut models = resolve_paths(app)
        .map(|paths| crate::official_models::cached_model_names(&paths))
        .unwrap_or_default();
    for model in settings.official_model_context_windows.keys() {
        if !models.contains(model) {
            models.push(model.clone());
        }
    }
    OfficialModelContextSettings {
        global_context_window: settings.gpt_5_6_sol_context_window,
        model_context_windows: settings.official_model_context_windows,
        models,
    }
}

#[tauri::command]
pub(crate) async fn get_official_model_context_settings<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<OfficialModelContextSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(official_context_settings(&app, read_app_settings(&app)?))
    })
    .await
    .map_err(|error| format!("Official model context settings task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_official_model_context_window<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    model: String,
    context_window: Option<u64>,
) -> Result<OfficialModelContextSettings, String> {
    let model = model.trim().to_string();
    if model.is_empty() {
        return Err("Model name cannot be empty".to_string());
    }
    if let Some(value) = context_window {
        validate_gpt_5_6_sol_context_window(value)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let settings = crate::storage::update_model_context_window(
            &app,
            crate::storage::ModelContextWindowUpdate::Model { model, context_window },
        )?;
        if let Ok(paths) = resolve_paths(&app) {
            if let Err(error) = update_cached_official_model_context_windows(
                &paths,
                settings.gpt_5_6_sol_context_window,
                &settings.official_model_context_windows,
            ) {
                log_proxy_error!("failed to update cached official model context windows: {error}");
            }
        }
        Ok(official_context_settings(&app, settings))
    })
    .await
    .map_err(|error| format!("Official model context update task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_upstream_429_retry_timeout<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    timeout_seconds: u64,
) -> Result<AppSettings, String> {
    if !(MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS..=MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS)
        .contains(&timeout_seconds)
    {
        return Err(format!(
            "429 retry time must be between {MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS} and \
             {MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS} seconds"
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut settings = read_app_settings(&app)?;
        settings.upstream_429_retry_timeout_seconds = timeout_seconds;
        write_app_settings(&app, &settings)?;
        Ok(settings)
    })
    .await
    .map_err(|error| format!("429 retry settings task failed: {error}"))?
}

fn validate_gpt_5_6_sol_context_window(context_window: u64) -> Result<(), String> {
    if !(MIN_GPT_5_6_SOL_CONTEXT_WINDOW..=MAX_GPT_5_6_SOL_CONTEXT_WINDOW).contains(&context_window)
        || !context_window.is_multiple_of(MIN_GPT_5_6_SOL_CONTEXT_WINDOW)
    {
        return Err("Context window must be a whole K value between 1K and 1050K".to_string());
    }
    Ok(())
}

fn set_gpt_5_6_sol_context_window_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    context_window: u64,
) -> Result<AppSettings, String> {
    let settings = crate::storage::update_model_context_window(
        app,
        crate::storage::ModelContextWindowUpdate::Global(context_window),
    )?;
    let paths = resolve_paths(app)?;
    if let Err(error) = update_cached_official_model_context_windows(
        &paths,
        context_window,
        &settings.official_model_context_windows,
    ) {
        // The proxy applies the override on the next model request even if this best-effort cache refresh races Codex.
        log_proxy_error!("failed to update the cached GPT-5.6 Sol context window: {error}");
    }
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn list_proxy_sessions<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<ProxySessionSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || list_proxy_sessions_blocking(&app))
        .await
        .map_err(|error| format!("Proxy session list task failed: {error}"))?
}

fn list_proxy_sessions_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<ProxySessionSummary>, String> {
    ensure_proxy_history(app)?;
    check_proxy_history_save()?;
    let sessions = proxy_sessions()
        .lock()
        .map_err(|_| "Proxy session registry lock is poisoned".to_string())?
        .values()
        .map(ProxySessionState::metadata_snapshot)
        .collect::<Vec<_>>();
    let paths = resolve_paths(app).ok();
    let official_context_windows = paths
        .as_ref()
        .map(official_model_context_windows)
        .unwrap_or_default();
    let upstream_official_provider_names = paths
        .as_ref()
        .map(upstream_official_provider_names)
        .unwrap_or_default();
    let provider_context_windows = paths
        .as_ref()
        .map(provider_context_windows)
        .unwrap_or_default();
    let session_ids = sessions
        .iter()
        .map(|session| session.id.clone())
        .collect::<HashSet<_>>();
    let conversation_titles = session_titles::resolve(app, &session_ids);
    remember_proxy_session_titles(&conversation_titles);
    let default_provider_context_window = providers::DEFAULT_MODEL_CONTEXT_WINDOW
        .saturating_mul(DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT)
        / 100;
    let mut summaries = sessions
        .iter()
        .map(|session| {
            let model_context_window = match (session.provider.as_deref(), session.model.as_deref())
            {
                (Some(provider), Some(model))
                    if uses_official_model_context(provider, &upstream_official_provider_names) =>
                {
                    official_context_windows.get(model).copied()
                }
                (Some(provider), Some(model)) => Some(
                    provider_context_windows
                        .get(provider)
                        .map(|windows| windows.for_model(model))
                        .unwrap_or(default_provider_context_window),
                ),
                _ => None,
            };
            ProxySessionSummary {
                id: session.id.clone(),
                title: conversation_titles
                    .get(&session.id)
                    .cloned()
                    .or_else(|| session.title.clone()),
                client: session.client.clone(),
                remote_address: session.remote_address.clone(),
                connected_at: session.connected_at,
                last_seen_at: session.last_seen_at,
                active_requests: session.active_requests,
                request_count: session.request_count,
                provider: session.provider.clone(),
                concurrent_routed: session.concurrent_routed,
                account_id: session.account_id.clone(),
                account_email: session.account_email.clone(),
                model: session.model.clone(),
                context_tokens: session.context_tokens,
                model_context_window: session.gui_context.as_ref()
                    .map_or(model_context_window, |context| context.capacity),
                total_tokens: session.token_totals.total_tokens,
                input_tokens: session.token_totals.input_tokens,
                output_tokens: session.token_totals.output_tokens,
                reasoning_tokens: session.token_totals.reasoning_tokens,
                cached_tokens: session.token_totals.cached_tokens,
            }
        })
        .collect::<Vec<_>>();
    summaries.sort_by(|left, right| {
        right
            .active_requests
            .cmp(&left.active_requests)
            .then_with(|| right.last_seen_at.cmp(&left.last_seen_at))
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(summaries)
}

#[tauri::command]
pub(crate) async fn get_recent_proxy_session_latency() -> Result<ProxySessionLatencySummary, String>
{
    tauri::async_runtime::spawn_blocking(get_recent_proxy_session_latency_blocking)
        .await
        .map_err(|error| format!("Proxy session latency task failed: {error}"))?
}

fn get_recent_proxy_session_latency_blocking() -> Result<ProxySessionLatencySummary, String> {
    let mut sessions = proxy_sessions()
        .lock()
        .map_err(|_| "Proxy session registry lock is poisoned".to_string())?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| {
        right
            .last_seen_at
            .cmp(&left.last_seen_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    let (total_first_response_time_ms, request_count) = sessions
        .into_iter()
        .take(5)
        .flat_map(|session| session.requests.into_iter())
        .filter_map(|request| request.first_response_time_ms)
        .fold((0_u64, 0_u64), |(total, count), first_response_time_ms| {
            (
                total.saturating_add(first_response_time_ms),
                count.saturating_add(1),
            )
        });

    Ok(ProxySessionLatencySummary {
        total_first_response_time_ms,
        request_count,
    })
}

#[tauri::command]
pub(crate) async fn export_diagnostic_logs<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || export_diagnostic_logs_blocking(&app, &path))
        .await
        .map_err(|_| "日志导出失败，请重试。".to_string())?
}

#[tauri::command]
pub(crate) async fn list_token_usage_entries<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<TokenUsageEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || list_token_usage_entries_blocking(&app))
        .await
        .map_err(|error| format!("Token usage list task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn get_proxy_session_unlimited_conversation() -> Result<bool, String> {
    Ok(proxy_session_unlimited_conversation().load(Ordering::Relaxed))
}

#[tauri::command]
pub(crate) async fn set_proxy_session_unlimited_conversation(
    enabled: bool,
) -> Result<bool, String> {
    proxy_session_unlimited_conversation().store(enabled, Ordering::Relaxed);
    Ok(enabled)
}

#[tauri::command]
pub(crate) async fn list_token_usage_entries_since<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    start_ts: u64,
) -> Result<Vec<TokenUsageEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_token_usage_entries_since_blocking(&app, start_ts)
    })
    .await
    .map_err(|error| format!("Token usage range task failed: {error}"))?
}

fn list_token_usage_entries_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<TokenUsageEntry>, String> {
    let mut entries = {
        let connection = open_token_usage_db(app)?;
        list_token_usage_entries_from_db(&connection, TOKEN_USAGE_LIST_LIMIT)?
    };
    enrich_token_usage_entries(app, &mut entries);
    Ok(entries)
}

pub(crate) fn list_token_usage_entries_since_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    start_ts: u64,
) -> Result<Vec<TokenUsageEntry>, String> {
    let mut entries = load_token_usage_summary_entries(app, start_ts)?;
    enrich_token_usage_entries(app, &mut entries);
    Ok(entries)
}

fn enrich_token_usage_entries<R: Runtime>(
    app: &tauri::AppHandle<R>,
    entries: &mut [TokenUsageEntry],
) {
    let paths = resolve_paths(app).ok();
    let official_context_windows = paths
        .as_ref()
        .map(official_model_context_windows)
        .unwrap_or_default();
    let upstream_official_provider_names = paths
        .as_ref()
        .map(upstream_official_provider_names)
        .unwrap_or_default();
    let provider_context_windows = paths
        .as_ref()
        .map(provider_context_windows)
        .unwrap_or_default();
    for entry in entries {
        entry.model_context_window =
            if uses_official_model_context(&entry.provider, &upstream_official_provider_names) {
                official_context_windows.get(&entry.model).copied()
            } else {
                Some(
                    provider_context_windows
                        .get(&entry.provider)
                        .map(|windows| windows.for_model(&entry.model))
                        .unwrap_or(
                            providers::DEFAULT_MODEL_CONTEXT_WINDOW
                                .saturating_mul(DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT)
                                / 100,
                        ),
                )
            };
    }
}

#[tauri::command]
pub(crate) async fn list_daily_token_usage<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    start_ts: u64,
) -> Result<Vec<DailyTokenUsage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_token_usage_db(&app)?;
        list_daily_token_usage_from_db(&connection, start_ts)
    })
    .await
    .map_err(|error| format!("Daily token usage task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_account_token_usage<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    start_ts: u64,
) -> Result<Vec<AccountTokenUsageTotals>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_token_usage_db(&app)?;
        list_account_token_usage_from_db(&connection, start_ts)
    })
    .await
    .map_err(|error| format!("Account token usage task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_provider_token_usage<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    start_ts: u64,
) -> Result<Vec<ProviderTokenUsageTotals>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_token_usage_db(&app)?;
        list_provider_token_usage_from_db(&connection, start_ts)
    })
    .await
    .map_err(|error| format!("Provider token usage task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn show_token_usage_window<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TOKEN_USAGE_WINDOW_LABEL) {
        let _ = window.destroy();
    }

    crate::webview_windows::builder(&app, TOKEN_USAGE_WINDOW_LABEL, token_usage_window_url())
        .title("Token Usage")
        .inner_size(1180.0, 780.0)
        .min_inner_size(900.0, 620.0)
        .resizable(true)
        .maximizable(true)
        .closable(true)
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn token_usage_window_url() -> WebviewUrl {
    WebviewUrl::App("index.html#token-usage".into())
}
