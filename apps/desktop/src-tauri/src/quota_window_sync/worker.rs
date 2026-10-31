use chrono::Utc;
use tauri::{AppHandle, Runtime};

use crate::{
    commands,
    models::AccountSummary,
    storage::{self, Paths},
};

use super::policy::{can_start_window, WINDOW_SECONDS};

const MAX_CONCURRENT_STARTS: usize = 4;
const ATTEMPT_FILE: &str = "quota-window-sync.json";

fn enabled<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    Ok(storage::read_app_settings(app)?.quota_window_sync_enabled)
}

pub(super) fn synchronize<R: Runtime>(app: &AppHandle<R>, source_id: &str) -> Result<(), String> {
    if !enabled(app)? {
        return Ok(());
    }
    let paths = storage::resolve_paths(app)?;
    let accounts = commands::list_accounts_blocking(app.clone())?;
    let accounts: Vec<_> = accounts
        .iter()
        .filter(|account| eligible_account(account, source_id))
        .collect();
    for batch in accounts.chunks(MAX_CONCURRENT_STARTS) {
        std::thread::scope(|scope| {
            for account in batch {
                let paths = &paths;
                scope.spawn(move || {
                    if let Err(error) = start_if_idle(app, paths, account) {
                        // Never surface credentials or upstream response bodies in the interface.
                        eprintln!("Background quota window activation failed: {error}");
                    }
                });
            }
        });
    }
    Ok(())
}

fn eligible_account(account: &AccountSummary, source_id: &str) -> bool {
    account.id != source_id
        && account.auto_switch_enabled
        && account.local_proxy_compatible
        && (account.expires_at.is_empty()
            || account.expires_at.as_str() >= Utc::now().format("%Y-%m-%d").to_string().as_str())
}

fn start_if_idle<R: Runtime>(
    app: &AppHandle<R>,
    paths: &Paths,
    account: &AccountSummary,
) -> Result<(), String> {
    let id = &account.id;
    if attempt_pending(paths, id, Utc::now().timestamp())? || !enabled(app)? {
        return Ok(());
    }
    // Cached quota is never sufficient authorization to spend an account's allowance.
    let usage = commands::try_refresh_usage_blocking(app, id)?;
    let now = Utc::now().timestamp();
    if !can_start_window(&usage, now)
        || !enabled(app)?
        || storage::try_read_state(paths)?
            .disabled_account_ids
            .contains(id)
    {
        return Ok(());
    }
    // Persist before sending: a timeout or restart must not replay a potentially charged request.
    storage::write_json_atomic(
        &storage::account_dir(paths, id).join(ATTEMPT_FILE),
        &serde_json::json!({ "notBefore": now + WINDOW_SECONDS }),
    )?;
    let consumed = commands::consume_account_quota_blocking(app.clone(), id.clone());
    // Even a failed stream may have spent quota. Always try to read the authoritative reset time.
    let refreshed = commands::try_refresh_usage_blocking(app, id);
    consumed?;
    refreshed.map(|_| ())
}

fn attempt_pending(paths: &Paths, id: &str, now: i64) -> Result<bool, String> {
    let path = storage::account_dir(paths, id).join(ATTEMPT_FILE);
    if !path.exists() {
        return Ok(false);
    }
    let value = storage::read_json(&path)?;
    // Corrupt markers fail closed rather than silently authorizing another charge.
    let until = value
        .get("notBefore")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| "Invalid quota window synchronization marker".to_string())?;
    Ok(until > now)
}

#[cfg(test)]
#[path = "worker_tests.rs"]
mod tests;
