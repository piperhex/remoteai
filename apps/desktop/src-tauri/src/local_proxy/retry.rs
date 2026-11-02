fn upstream_429_retry_timeout<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Duration, String> {
    let seconds = read_app_settings(app)?
        .upstream_429_retry_timeout_seconds
        .clamp(
            MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
            MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS,
        );
    Ok(Duration::from_secs(seconds))
}

fn retry_upstream_request<F, S>(
    timeout: Duration,
    request: F,
    handle_quota_event: S,
) -> Result<UpstreamPayload, String>
where
    F: FnMut() -> Result<UpstreamPayload, String>,
    S: FnMut(&UpstreamPayload, UpstreamQuotaEvent) -> bool,
{
    let started_at = Instant::now();
    retry_upstream_request_with(timeout, request, handle_quota_event, |delay| {
        thread::sleep(delay.min(timeout.saturating_sub(started_at.elapsed())));
        started_at.elapsed()
    })
}

/// Aggregates own their entire attempt budget; a final 429 must not start a second round.
fn retry_upstream_request_for_target<F, S>(
    aggregate: bool,
    timeout: Duration,
    mut request: F,
    handle_quota_event: S,
) -> Result<UpstreamPayload, String>
where
    F: FnMut() -> Result<UpstreamPayload, String>,
    S: FnMut(&UpstreamPayload, UpstreamQuotaEvent) -> bool,
{
    if aggregate {
        request()
    } else {
        retry_upstream_request(timeout, request, handle_quota_event)
    }
}

fn retry_upstream_request_with<F, S, W>(
    timeout: Duration,
    mut request: F,
    mut handle_quota_event: S,
    mut wait_before_retry: W,
) -> Result<UpstreamPayload, String>
where
    F: FnMut() -> Result<UpstreamPayload, String>,
    S: FnMut(&UpstreamPayload, UpstreamQuotaEvent) -> bool,
    W: FnMut(Duration) -> Duration,
{
    let mut attempt = 0_u64;
    let mut retry_number = 0_u16;
    let mut quota_retry = QuotaRetryState::default();
    loop {
        attempt = attempt.saturating_add(1);
        let started = Instant::now();
        diagnostic_event(json!({ "event": "upstream_attempt_started", "attempt": attempt }));
        let result = request();
        diagnostic_attempt(&result, attempt, started);
        let response = result?;
        // A confirmed concurrent quota failure invalidates cached eligibility before
        // any backoff, including when the normal 429 retry budget is exhausted.
        if concurrent_quota::exclude_response(&response)? {
            diagnostic_retry("concurrent_account_excluded", Duration::ZERO);
            record_retried_proxy_response(&response);
            continue;
        }
        if switch_exhausted_account(&response, &mut quota_retry, &mut handle_quota_event) {
            diagnostic_retry("quota_account_switch", Duration::ZERO);
            record_retried_proxy_response(&response);
            continue;
        }
        // Confirmed exhaustion cannot recover through backoff without a new target.
        if response.status != 429 || is_official_quota_exhaustion(&response) {
            return Ok(response);
        }
        retry_number = retry_number.saturating_add(1);
        let delay = upstream_429_retry_delay(retry_number);
        diagnostic_retry("rate_limit", delay);
        let elapsed = wait_before_retry(delay);
        if elapsed >= timeout {
            diagnostic_event(json!({ "event": "retry_budget_exhausted", "attempt": attempt }));
            let _ = handle_quota_event(&response, UpstreamQuotaEvent::RetryTimedOut);
            return Ok(response);
        }
        record_retried_proxy_response(&response);
    }
}

#[derive(Default)]
struct QuotaRetryState {
    exhausted_account_ids: HashSet<String>,
    switched_account_ids: HashSet<String>,
}

fn switch_exhausted_account(
    response: &UpstreamPayload,
    quota_retry: &mut QuotaRetryState,
    handle_quota_event: &mut impl FnMut(&UpstreamPayload, UpstreamQuotaEvent) -> bool,
) -> bool {
    let Some(account) = response.token_usage_account.as_ref() else {
        return false;
    };
    if !account_failure::requires_account_failover(response) {
        return false;
    }
    quota_retry
        .exhausted_account_ids
        .insert(account.account_id.clone());
    if quota_retry
        .switched_account_ids
        .contains(&account.account_id)
    {
        return false;
    }
    // Quota exhaustion and rejected credentials need a different account, even if the retry budget has
    // expired. Retry a successful switch immediately, before any backoff or auto-disable.
    let event = UpstreamQuotaEvent::Retry {
        exhausted_account_ids: quota_retry.exhausted_account_ids.clone(),
    };
    let switched = handle_quota_event(response, event);
    diagnostic_event(json!({
        "event": "quota_switch_result", "switched": switched,
        "account": diagnostic_account(account)
    }));
    if !switched {
        return false;
    }
    // Stale positive usage can send us back to an exhausted account. Bound immediate
    // failovers per request so that cycle terminates with the quota error.
    quota_retry
        .switched_account_ids
        .insert(account.account_id.clone());
    true
}
