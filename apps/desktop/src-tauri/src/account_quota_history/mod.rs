//! Persist observed account quota levels independently from request token totals.

mod database;
mod models;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod integration_tests;

use std::{collections::BTreeMap, fs};

use chrono::{DateTime, Utc};
use tauri::Runtime;

use crate::{
    auth::account_fields,
    models::{UsageSummary, UsageWindow},
    storage::{read_json, resolve_paths, Paths},
};

pub(crate) use models::{AccountQuotaHistory, AccountQuotaPoint};
use models::{HistoryError, HistoryRange};

/// Only successful observations are recorded; failed refreshes retain stale cached levels.
pub(crate) fn record_usage(
    paths: &Paths,
    account_id: &str,
    usage: &UsageSummary,
) -> Result<(), HistoryError> {
    let Some(point) = observed_point(usage) else {
        return Ok(());
    };
    let connection = database::open(paths)?;
    database::insert(&connection, account_id, &point)
}

fn observed_point(usage: &UsageSummary) -> Option<AccountQuotaPoint> {
    if usage.error.is_some() {
        return None;
    }
    let ts = DateTime::parse_from_rfc3339(usage.fetched_at.as_deref()?)
        .ok()?
        .timestamp();
    let primary = valid_window(usage.primary.as_ref());
    let secondary = valid_window(usage.secondary.as_ref());
    if ts < 0 || (primary.is_none() && secondary.is_none()) {
        return None;
    }
    Some(AccountQuotaPoint {
        ts,
        primary_remaining_percent: primary.map(|window| window.remaining_percent),
        secondary_remaining_percent: secondary.map(|window| window.remaining_percent),
        primary_reset_at: primary.and_then(|window| window.resets_at),
        secondary_reset_at: secondary.and_then(|window| window.resets_at),
    })
}

fn valid_window(window: Option<&UsageWindow>) -> Option<&UsageWindow> {
    window.filter(|window| {
        window.remaining_percent.is_finite() && (0.0..=100.0).contains(&window.remaining_percent)
    })
}

/// Return current managed login accounts, including accounts without observations yet.
fn current_accounts(paths: &Paths) -> Result<BTreeMap<String, AccountQuotaHistory>, HistoryError> {
    let mut accounts = BTreeMap::new();
    if !paths.accounts.exists() {
        return Ok(accounts);
    }
    for entry in fs::read_dir(&paths.accounts)? {
        let entry = entry?;
        let auth_path = entry.path().join("auth.json");
        if !entry.file_type()?.is_dir() || !auth_path.is_file() {
            continue;
        }
        // Refreshes use the managed directory id. Preserve it if credentials change their
        // metadata, and retain history when an individual account file cannot be read.
        let account_id = entry.file_name().to_string_lossy().into_owned();
        let account_label = read_json(&auth_path)
            .and_then(|auth| account_fields(&auth).map(|fields| fields.0))
            .unwrap_or_else(|_| "未命名账户".to_string());
        accounts.insert(
            account_id.clone(),
            AccountQuotaHistory {
                account_id,
                account_label,
                points: Vec::new(),
            },
        );
    }
    Ok(accounts)
}

fn list_history(
    paths: &Paths,
    range: HistoryRange,
) -> Result<Vec<AccountQuotaHistory>, HistoryError> {
    let mut accounts = current_accounts(paths)?;
    let connection = database::open(paths)?;
    database::append_points(&connection, &mut accounts, range)?;
    let mut histories: Vec<_> = accounts.into_values().collect();
    histories.sort_by(|left, right| left.account_label.cmp(&right.account_label));
    Ok(histories)
}

/// All filesystem access, SQLite waits, and history processing stay off the UI thread.
pub(crate) fn read_history(
    paths: &Paths,
    start_ts: i64,
    end_ts: i64,
) -> Result<Vec<AccountQuotaHistory>, HistoryError> {
    list_history(paths, HistoryRange::new(start_ts, end_ts)?)
}

/// All filesystem access, SQLite waits, and history processing stay off the UI thread.
#[tauri::command]
pub(crate) async fn list_account_quota_history<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    start_ts: i64,
    end_ts: Option<i64>,
) -> Result<Vec<AccountQuotaHistory>, String> {
    let range = HistoryRange::new(start_ts, end_ts.unwrap_or_else(|| Utc::now().timestamp()))
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let paths =
            resolve_paths(&app).map_err(|_| HistoryError::StorageUnavailable.to_string())?;
        list_history(&paths, range).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "读取账户额度记录失败，请重试。".to_string())?
}
