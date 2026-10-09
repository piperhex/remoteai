use std::collections::HashMap;

use crate::{
    account_quota_history::{read_history, AccountQuotaHistory, AccountQuotaPoint},
    auth::account_fields,
    codex_usage_cost_rates,
    local_proxy::load_token_usage_summary_entries,
    models::TokenUsageEntry,
    storage::{read_json, resolve_paths, Paths},
};
use serde::{Deserialize, Serialize};
use tauri::Runtime;

const HISTORY_SECONDS: i64 = 53 * 7 * 24 * 60 * 60;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageSample {
    ts: u64,
    tokens: u64,
    cost_usd: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountUsage {
    account_id: String,
    account_label: String,
    samples: Vec<UsageSample>,
    points: Vec<AccountQuotaPoint>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceUsage {
    device_name: String,
    accounts: Vec<AccountUsage>,
}

struct AccountIdentity {
    id: String,
    workspace: Option<String>,
    email: String,
}

// Email alone is safe only when it identifies exactly one managed account.
fn match_account<'a>(
    entry: &TokenUsageEntry,
    identities: &'a [AccountIdentity],
) -> Option<&'a str> {
    if entry.provider != "Official Codex" || entry.provider_id.is_some() {
        return None;
    }
    let id = entry.account_id.as_deref();
    if let Some(account) = identities
        .iter()
        .find(|account| Some(account.id.as_str()) == id)
    {
        return Some(&account.id);
    }
    let email = entry.account_email.as_deref().unwrap_or_default().trim();
    let mut candidates = identities.iter().filter(|account| {
        !email.is_empty()
            && account.email.eq_ignore_ascii_case(email)
            && (id.is_none() || account.workspace.as_deref() == id)
    });
    let account = candidates.next()?;
    candidates.next().is_none().then_some(account.id.as_str())
}

pub(super) fn snapshot<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<DeviceUsage, String> {
    let paths = resolve_paths(app)?;
    let captured_at = chrono::Utc::now().timestamp();
    let start_ts = (captured_at - HISTORY_SECONDS).max(0) / 60 * 60;
    let history = read_history(&paths, start_ts, captured_at).map_err(|error| error.to_string())?;
    let (mut accounts, identities) = collect_accounts(&paths, history);
    let rates = codex_usage_cost_rates::load(&paths)?;
    for entry in load_token_usage_summary_entries(app, start_ts as u64)? {
        if entry.ts > captured_at as u64 {
            continue;
        }
        let Some(id) = match_account(&entry, &identities) else {
            continue;
        };
        if let Some(account) = accounts.get_mut(id) {
            account.samples.push(usage_sample(&entry, &rates));
        }
    }
    let mut accounts: Vec<_> = accounts.into_values().collect();
    accounts.sort_by(|left, right| left.account_id.cmp(&right.account_id));
    Ok(DeviceUsage {
        device_name: sysinfo::System::host_name().unwrap_or_else(|| "Remote AI".into()),
        accounts,
    })
}

fn collect_accounts(
    paths: &Paths,
    history: Vec<AccountQuotaHistory>,
) -> (HashMap<String, AccountUsage>, Vec<AccountIdentity>) {
    let mut accounts = HashMap::new();
    let mut identities = Vec::new();
    for account in history {
        let auth_path = paths.accounts.join(&account.account_id).join("auth.json");
        let fields = read_json(&auth_path).and_then(|auth| account_fields(&auth));
        let Ok((email, _, workspace, _)) = fields else {
            continue;
        };
        identities.push(AccountIdentity {
            id: account.account_id.clone(),
            workspace,
            email,
        });
        accounts.insert(
            account.account_id.clone(),
            AccountUsage {
                account_id: account.account_id,
                account_label: account.account_label,
                samples: Vec::new(),
                points: compact_points(account.points),
            },
        );
    }
    (accounts, identities)
}

fn usage_sample(entry: &TokenUsageEntry, rates: &codex_usage_cost_rates::CostRates) -> UsageSample {
    UsageSample {
        ts: entry.ts,
        tokens: entry.total_tokens.unwrap_or_else(|| {
            entry
                .input_tokens
                .unwrap_or(0)
                .saturating_add(entry.output_tokens.unwrap_or(0))
        }),
        cost_usd: rates.estimate_cost(entry, None),
    }
}

// Keep both ends of a plateau so sampling retains reset boundaries and freshness.
fn compact_points(points: Vec<AccountQuotaPoint>) -> Vec<AccountQuotaPoint> {
    let mut result: Vec<AccountQuotaPoint> = Vec::new();
    for point in points {
        let len = result.len();
        if len >= 2
            && same_level(&result[len - 2], &result[len - 1])
            && same_level(&result[len - 1], &point)
        {
            result[len - 1] = point;
        } else {
            result.push(point);
        }
    }
    result
}

fn same_level(left: &AccountQuotaPoint, right: &AccountQuotaPoint) -> bool {
    left.primary_remaining_percent == right.primary_remaining_percent
        && left.secondary_remaining_percent == right.secondary_remaining_percent
        && left.primary_reset_at == right.primary_reset_at
        && left.secondary_reset_at == right.secondary_reset_at
}

mod report;
pub(super) use report::{prepare_report, ReportCheckpoint, UsageReport};
