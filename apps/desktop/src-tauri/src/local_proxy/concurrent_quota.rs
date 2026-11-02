use super::{account_failure, reported_quota_windows_have_remaining, UpstreamPayload};
use crate::models::UsageSummary;
use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard, OnceLock},
    time::Instant,
};

static QUOTA_STATE: OnceLock<Mutex<ConcurrentQuotaState>> = OnceLock::new();

#[derive(Default)]
struct ConcurrentQuotaState {
    accounts: HashMap<String, AccountQuotaState>,
}

enum AccountQuotaState {
    Exhausted { observed_at: Instant },
    Recovered { refresh_started_at: Instant },
}

impl ConcurrentQuotaState {
    fn exclude(&mut self, account_id: &str, request_started_at: Instant, observed_at: Instant) {
        match self.accounts.get(account_id) {
            // Several in-flight requests can report the same exhaustion. Keep the
            // first observation so they cannot invalidate a subsequent usage refresh.
            Some(AccountQuotaState::Exhausted { .. }) => return,
            Some(AccountQuotaState::Recovered { refresh_started_at })
                if request_started_at < *refresh_started_at =>
            {
                return
            }
            _ => {}
        }
        self.accounts.insert(
            account_id.to_string(),
            AccountQuotaState::Exhausted { observed_at },
        );
    }

    fn recover(&mut self, account_id: &str, refresh_started_at: Instant, usage: &UsageSummary) {
        let Some(AccountQuotaState::Exhausted { observed_at }) = self.accounts.get(account_id)
        else {
            return;
        };
        // A refresh already in flight when exhaustion was observed may still return
        // stale positive usage. Missing windows and failed refreshes prove no recovery.
        if refresh_started_at <= *observed_at
            || usage.error.is_some()
            || (usage.primary.is_none() && usage.secondary.is_none())
            || !reported_quota_windows_have_remaining(usage)
        {
            return;
        }
        self.accounts.insert(
            account_id.to_string(),
            AccountQuotaState::Recovered { refresh_started_at },
        );
    }

    fn is_available(&self, account_id: &str) -> bool {
        !matches!(
            self.accounts.get(account_id),
            Some(AccountQuotaState::Exhausted { .. })
        )
    }
}

fn quota_state() -> Result<MutexGuard<'static, ConcurrentQuotaState>, String> {
    QUOTA_STATE
        .get_or_init(Mutex::default)
        .lock()
        .map_err(|_| "Concurrent quota state lock is poisoned".to_string())
}

pub(super) fn retain_available(account_ids: &mut Vec<String>) -> Result<(), String> {
    let state = quota_state()?;
    account_ids.retain(|id| state.is_available(id));
    Ok(())
}

pub(super) fn exclude_response(response: &UpstreamPayload) -> Result<bool, String> {
    let Some(account) = response.token_usage_account.as_ref() else {
        return Ok(false);
    };
    let Some(request_started_at) = account.concurrent_request_started_at else {
        return Ok(false);
    };
    if !account_failure::requires_account_failover(response) {
        return Ok(false);
    }
    quota_state()?.exclude(&account.account_id, request_started_at, Instant::now());
    Ok(true)
}

/// Re-admit an exhausted concurrent account only after a fresh successful usage query.
pub(crate) fn record_usage_refresh(
    account_id: &str,
    refresh_started_at: Instant,
    usage: &UsageSummary,
) -> Result<(), String> {
    quota_state()?.recover(account_id, refresh_started_at, usage);
    Ok(())
}

#[cfg(test)]
#[path = "concurrent_quota_tests.rs"]
mod tests;
