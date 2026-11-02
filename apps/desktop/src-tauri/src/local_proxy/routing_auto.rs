fn upstream_429_retry_delay(retry_number: u16) -> Duration {
    let additional_seconds =
        u64::from(retry_number.saturating_sub(1)).saturating_mul(UPSTREAM_429_DELAY_STEP_SECONDS);
    Duration::from_secs(UPSTREAM_429_INITIAL_DELAY_SECONDS.saturating_add(additional_seconds))
}

fn try_switch_official_account_after_quota<R: Runtime>(
    app: &tauri::AppHandle<R>,
    response: &UpstreamPayload,
    exhausted_account_ids: &HashSet<String>,
) -> bool {
    let Some(account) = response
        .token_usage_account
        .as_ref()
        .filter(|account| credential_can_trigger_auto_switch(account))
    else {
        return false;
    };
    match auto_switch_official_account(
        app,
        AutoSwitchRequest {
            observed_generation: account.active_account_generation,
            observed_attempt_generation: account.auto_switch_attempt_generation,
            failed_account_id: &account.account_id,
            exhausted_account_ids,
            allow_quota_reset: !account_failure::is_authentication_failure(response),
        },
    ) {
        Ok(switched) => switched,
        Err(error) => {
            log_proxy_error!(
                "failed to automatically switch official account after upstream rejection: {error}"
            );
            false
        }
    }
}

fn credential_can_trigger_auto_switch(account: &TokenUsageAccount) -> bool {
    account.auto_switch_eligible
}

struct AutoSwitchRequest<'a> {
    observed_generation: u64,
    observed_attempt_generation: u64,
    failed_account_id: &'a str,
    exhausted_account_ids: &'a HashSet<String>,
    allow_quota_reset: bool,
}

fn auto_switch_official_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    request: AutoSwitchRequest<'_>,
) -> Result<bool, String> {
    diagnostic_event(json!({
        "event": "account_switch_started", "failedAccountHash": short_hash_str(request.failed_account_id),
        "exhaustedAccountCount": request.exhausted_account_ids.len()
    }));
    let should_retry = auto_switch_coordinator().switch_or_wait(
        request.observed_generation,
        request.observed_attempt_generation,
        request.failed_account_id,
        || {
            try_auto_switch_official_account(
                app,
                request.failed_account_id,
                request.exhausted_account_ids,
                request.allow_quota_reset,
            )
        },
    )?;
    diagnostic_event(json!({ "event": "account_switch_finished", "retry": should_retry }));
    if !should_retry {
        return Ok(false);
    }

    // The retry resolves the active target again. A successful automatic fallback may now
    // point at either another official account or the configured third-party Provider.
    let state = read_state(&resolve_paths(app)?);
    Ok(state.active_provider_id.is_some()
        || state.active_provider_group.is_some()
        || state.active_account_id.is_some())
}

fn try_auto_switch_official_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    failed_account_id: &str,
    exhausted_account_ids: &HashSet<String>,
    allow_quota_reset: bool,
) -> Result<AutoSwitchAttempt, String> {
    let paths = resolve_paths(app)?;
    let state = try_read_state(&paths)?;
    if automatic_switch_is_blocked(&state) {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    let Some(current_id) = state.active_account_id else {
        return Ok(AutoSwitchAttempt::Unchanged);
    };

    // A manual official-account switch also makes the failed request stale. Retry against
    // it without advancing the automatic-switch generation or switching away from it.
    if current_id != failed_account_id {
        return Ok(AutoSwitchAttempt::AlreadyChanged);
    }

    // The quota result that triggered this flow can be stale, so refresh every enabled
    // official account before choosing a replacement instead of relying on cached usage.
    let accounts = crate::commands::list_accounts_blocking(app.clone())?;
    if !accounts
        .iter()
        .any(|account| can_leave_failed_account(account, &current_id, exhausted_account_ids))
    {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    let mut refreshed_accounts = Vec::new();
    let mut backup_usage_unknown = false;
    for mut account in accounts
        .into_iter()
        .filter(|account| account.auto_switch_enabled)
    {
        match crate::commands::refresh_usage_blocking(app.clone(), account.id.clone()) {
            Ok(usage) => {
                account.usage = usage;
                refreshed_accounts.push(account);
            }
            Err(error) => {
                if account.id != current_id && !exhausted_account_ids.contains(&account.id) {
                    backup_usage_unknown = true;
                }
                log_proxy_error!(
                    "failed to refresh usage for {} during automatic switch: {error}",
                    account.id
                );
            }
        }
    }
    // Keep refreshing failed accounts above for the UI and reset-card checks, but an
    // actual quota failure in this request takes precedence over stale positive usage.
    retain_untried_auto_switch_accounts(&mut refreshed_accounts, exhausted_account_ids);

    // Do not overwrite a manual account or Provider switch made while usage was refreshing.
    let state = try_read_state(&paths)?;
    if automatic_switch_is_blocked(&state) {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    if state.active_account_id.as_deref() != Some(&current_id) {
        return Ok(if state.active_account_id.is_some() {
            AutoSwitchAttempt::AlreadyChanged
        } else {
            AutoSwitchAttempt::Unchanged
        });
    }

    if let Some(target) = account_with_lowest_remaining_primary_quota(
        &refreshed_accounts,
        &current_id,
        state.custom_auto_switch_priority_enabled,
        state.custom_auto_switch_threshold_enabled,
        state.global_auto_switch_threshold,
    ) {
        let target_id = target.id.clone();
        if let Err(error) =
            crate::commands::switch_account_automatically_blocking(app.clone(), target_id.clone())
        {
            // switch_account writes the selected account before emitting UI events. If a
            // post-switch side effect failed, the new account is still active and concurrent
            // quota responses must be released to retry against it.
            let state = read_state(&paths);
            if state.active_provider_id.is_none()
                && state.active_account_id.as_deref() == Some(&target_id)
            {
                log_proxy_error!(
                    "automatic account switch to {target_id} completed with a post-switch error: {error}"
                );
                return Ok(AutoSwitchAttempt::Switched);
            }
            return Err(error);
        }
        return Ok(AutoSwitchAttempt::Switched);
    }

    if backup_usage_unknown
        || !all_backup_accounts_have_exhausted_quota(
            &refreshed_accounts,
            &current_id,
            state.custom_auto_switch_threshold_enabled,
            state.global_auto_switch_threshold,
        )
    {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    // Reset cards restore quota, not login credentials.
    let restored = if allow_quota_reset {
        auto_reset::restore(app)
    } else {
        Ok(Vec::new())
    };
    match restored {
        Ok(restored) if !restored.is_empty() => {
            let latest = try_read_state(&paths)?;
            if automatic_switch_is_blocked(&latest)
                || latest.active_account_id.as_deref() != Some(&current_id)
            {
                return Ok(AutoSwitchAttempt::Unchanged);
            }
            if restored[0] != current_id {
                crate::commands::switch_account_automatically_blocking(
                    app.clone(),
                    restored[0].clone(),
                )?;
            }
            return Ok(AutoSwitchAttempt::Switched);
        }
        Err(error) => log_proxy_error!("automatic quota reset failed: {error}"),
        _ => {}
    }
    let state = try_read_state(&paths)?;
    if automatic_switch_is_blocked(&state)
        || state.active_account_id.as_deref() != Some(&current_id)
    {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    let Some(provider_id) = state.auto_switch_provider_id else {
        return Ok(AutoSwitchAttempt::Unchanged);
    };
    let provider = providers::read_provider(&paths, &provider_id)?;
    if provider.kind != ProviderKind::Custom {
        return Ok(AutoSwitchAttempt::Unchanged);
    }
    if let Err(error) = providers::switch_provider_blocking(app.clone(), provider_id.clone()) {
        let state = read_state(&paths);
        if state.active_provider_id.as_deref() == Some(&provider_id) {
            log_proxy_error!(
                "automatic fallback to Provider {provider_id} completed with a post-switch error: {error}"
            );
            return Ok(AutoSwitchAttempt::Switched);
        }
        return Err(error);
    }
    Ok(AutoSwitchAttempt::Switched)
}

fn automatic_switch_is_blocked(state: &ManagerStateFile) -> bool {
    !state.auto_switch_on_quota_exhaustion
        || state.concurrent_account_routing_enabled
        || state.active_provider_id.is_some()
        || state.active_provider_group.is_some()
}

fn can_leave_failed_account(
    account: &AccountSummary,
    current_id: &str,
    failed_account_ids: &HashSet<String>,
) -> bool {
    // Background usage refresh may already have disabled this account. Exclusion
    // prevents selecting it again; it must not pin an in-flight request to it.
    account.id == current_id
        && (account.auto_switch_enabled || failed_account_ids.contains(current_id))
}

fn retain_untried_auto_switch_accounts(
    accounts: &mut Vec<AccountSummary>,
    exhausted_account_ids: &HashSet<String>,
) {
    accounts.retain(|account| !exhausted_account_ids.contains(&account.id));
}

fn all_backup_accounts_have_exhausted_quota(
    accounts: &[AccountSummary],
    current_id: &str,
    custom_threshold_enabled: bool,
    global_threshold: f64,
) -> bool {
    accounts
        .iter()
        .filter(|account| account.id != current_id && account.auto_switch_enabled)
        .filter(|account| {
            account_meets_threshold(account, custom_threshold_enabled, global_threshold)
        })
        .all(|account| {
            account.usage.error.is_none() && !reported_quota_windows_have_remaining(&account.usage)
        })
}

fn account_with_lowest_remaining_primary_quota<'a>(
    accounts: &'a [AccountSummary],
    current_id: &str,
    custom_priority_enabled: bool,
    custom_threshold_enabled: bool,
    global_threshold: f64,
) -> Option<&'a AccountSummary> {
    accounts
        .iter()
        .filter(|account| account.id != current_id)
        .filter(|account| account.auto_switch_enabled)
        .filter_map(|account| {
            let score = primary_remaining_quota_score(&account.usage)?;
            account_meets_threshold(account, custom_threshold_enabled, global_threshold)
                .then_some((account, score))
        })
        .min_by(|(left_account, left_usage), (right_account, right_usage)| {
            let priority_order = if custom_priority_enabled {
                left_account
                    .auto_switch_priority
                    .cmp(&right_account.auto_switch_priority)
            } else {
                std::cmp::Ordering::Equal
            };
            priority_order.then_with(|| {
                left_usage
                    .partial_cmp(right_usage)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        })
        .map(|(account, _)| account)
}

#[derive(Clone)]
enum UpstreamQuotaEvent {
    Retry {
        exhausted_account_ids: HashSet<String>,
    },
    RetryTimedOut,
}

fn handle_upstream_quota_event<R: Runtime>(
    app: &tauri::AppHandle<R>,
    response: &UpstreamPayload,
    event: UpstreamQuotaEvent,
) -> bool {
    match event {
        UpstreamQuotaEvent::Retry {
            exhausted_account_ids,
        } => try_switch_official_account_after_quota(app, response, &exhausted_account_ids),
        UpstreamQuotaEvent::RetryTimedOut => {
            if let Err(error) = try_disable_official_account_after_429_timeout(app, response) {
                log_proxy_error!(
                    "failed to automatically disable official account after 429 retry timeout: {error}"
                );
            }
            false
        }
    }
}

fn try_disable_official_account_after_429_timeout<R: Runtime>(
    app: &tauri::AppHandle<R>,
    response: &UpstreamPayload,
) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    let settings = read_app_settings(app)?;
    let Some(account_id) = account_to_disable_after_429_timeout(response, &state, &settings) else {
        return Ok(());
    };
    let changed =
        crate::commands::set_account_auto_switch_enabled_for_paths(&paths, account_id, false)?;
    if changed {
        app.emit("accounts-changed", ())
            .map_err(|error| error.to_string())?;
        crate::system_tray::refresh_menu(app);
    }
    Ok(())
}

fn account_to_disable_after_429_timeout<'a>(
    response: &'a UpstreamPayload,
    state: &ManagerStateFile,
    settings: &AppSettings,
) -> Option<&'a str> {
    if response.status != 429
        || !state.auto_switch_on_quota_exhaustion
        || state.concurrent_account_routing_enabled
        || !state.auto_disable_unreachable_accounts
        || !settings.auto_disable_status_codes.contains(&429)
    {
        return None;
    }
    response
        .token_usage_account
        .as_ref()
        .filter(|account| credential_can_trigger_auto_switch(account))
        .map(|account| account.account_id.as_str())
}

pub(crate) fn maybe_switch_official_account_below_threshold<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<bool, String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    if !state.auto_switch_on_quota_exhaustion
        || state.concurrent_account_routing_enabled
        || !state.custom_auto_switch_threshold_enabled
        || state.active_provider_id.is_some()
        || state.active_provider_group.is_some()
    {
        return Ok(false);
    }
    let Some(current_id) = state.active_account_id else {
        return Ok(false);
    };
    if state.disabled_account_ids.contains(&current_id) {
        return Ok(false);
    }
    let usage = load_usage(&usage_path(&paths, &current_id));
    let Some(primary) = usage.primary.as_ref() else {
        return Ok(false);
    };
    let threshold = effective_auto_switch_threshold(
        load_auto_switch_threshold(&auto_switch_threshold_path(&paths, &current_id)),
        state.global_auto_switch_threshold,
        true,
    );
    if usage.error.is_some() || primary.remaining_percent >= threshold {
        return Ok(false);
    }
    let (observed_generation, observed_attempt_generation, _) =
        auto_switch_coordinator().account_snapshot(|| Ok(()))?;
    auto_switch_official_account(
        app,
        AutoSwitchRequest {
            observed_generation,
            observed_attempt_generation,
            failed_account_id: &current_id,
            exhausted_account_ids: &HashSet::new(),
            allow_quota_reset: true,
        },
    )
}

fn effective_auto_switch_threshold(
    account_threshold: f64,
    global_threshold: f64,
    custom_threshold_enabled: bool,
) -> f64 {
    if !custom_threshold_enabled {
        return 0.0;
    }
    account_threshold.max(global_threshold)
}

fn account_meets_threshold(
    account: &AccountSummary,
    custom_threshold_enabled: bool,
    global_threshold: f64,
) -> bool {
    if !custom_threshold_enabled {
        return true;
    }
    let threshold = effective_auto_switch_threshold(
        account.auto_switch_threshold,
        global_threshold,
        custom_threshold_enabled,
    );
    primary_remaining_quota_score(&account.usage).is_some_and(|remaining| remaining >= threshold)
}

fn ensure_active_official_account_meets_threshold<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    if !state.auto_switch_on_quota_exhaustion || !state.custom_auto_switch_threshold_enabled {
        return Ok(());
    }
    let Some(current_id) = state.active_account_id else {
        return Ok(());
    };
    let usage = load_usage(&usage_path(&paths, &current_id));
    let Some(primary) = usage.primary.as_ref() else {
        return Ok(());
    };
    let threshold = effective_auto_switch_threshold(
        load_auto_switch_threshold(&auto_switch_threshold_path(&paths, &current_id)),
        state.global_auto_switch_threshold,
        true,
    );
    if usage.error.is_none() && primary.remaining_percent < threshold {
        return Err("No enabled official account meets the configured usage threshold".to_string());
    }
    Ok(())
}
