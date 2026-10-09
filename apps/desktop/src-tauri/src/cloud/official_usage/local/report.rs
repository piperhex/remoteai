use super::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const RECORD_BATCH_SIZE: usize = 500;
const MINUTE_SECONDS: u64 = 60;
const REPORT_VERSION: u8 = 2;

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportCheckpoint {
    buckets: BTreeMap<String, String>,
    quotas: BTreeMap<String, AccountQuotaPoint>,
    labels: BTreeMap<String, String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageMinute {
    ts: u64,
    samples: Vec<(u64, u64, f64)>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountReport {
    account_id: String,
    account_label: String,
    minutes: Vec<UsageMinute>,
    quotas: Vec<AccountQuotaPoint>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageReport {
    version: u8,
    device_name: String,
    accounts: Vec<AccountReport>,
}

/// Local checkpoints hold only acknowledged hashes and quota levels, never other devices' records.
pub(crate) fn prepare_report(
    snapshot: DeviceUsage,
    previous: ReportCheckpoint,
    started_at: i64,
) -> Result<(Vec<UsageReport>, ReportCheckpoint), String> {
    let mut checkpoint = ReportCheckpoint::default();
    let mut reports = Vec::new();
    for mut account in snapshot.accounts {
        // History reads include the preceding quota point; it must not become
        // the baseline for statistics started by this upgraded installation.
        account.points.retain(|point| point.ts >= started_at);
        account
            .samples
            .retain(|sample| sample.ts >= started_at as u64);
        account.points = compact_points(account.points);
        let mut report = AccountReport {
            account_id: account.account_id.clone(),
            account_label: account.account_label.clone(),
            minutes: Vec::new(),
            quotas: Vec::new(),
        };
        report.minutes = changed_minutes(&account, &previous, &mut checkpoint)?;
        report.quotas = changed_quotas(&account, &previous, &mut checkpoint);
        checkpoint
            .labels
            .insert(account.account_id.clone(), account.account_label.clone());
        let renamed = previous.labels.get(&account.account_id) != Some(&account.account_label);
        if renamed || !report.minutes.is_empty() || !report.quotas.is_empty() {
            reports.extend(
                account_batches(report)
                    .into_iter()
                    .map(|account| UsageReport {
                        version: REPORT_VERSION,
                        device_name: snapshot.device_name.clone(),
                        accounts: vec![account],
                    }),
            );
        }
    }
    Ok((reports, checkpoint))
}

fn changed_minutes(
    account: &AccountUsage,
    previous: &ReportCheckpoint,
    checkpoint: &mut ReportCheckpoint,
) -> Result<Vec<UsageMinute>, String> {
    let mut changed = Vec::new();
    for minute in group_minutes(&account.samples) {
        let key = format!("{}:{}", account.account_id, minute.ts);
        let hash = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&minute).map_err(|error| error.to_string())?)
        );
        if previous.buckets.get(&key) != Some(&hash) {
            changed.push(minute);
        }
        checkpoint.buckets.insert(key, hash);
    }
    Ok(changed)
}

fn changed_quotas(
    account: &AccountUsage,
    previous: &ReportCheckpoint,
    checkpoint: &mut ReportCheckpoint,
) -> Vec<AccountQuotaPoint> {
    let mut changed = Vec::new();
    let mut latest = previous.quotas.get(&account.account_id).cloned();
    for point in &account.points {
        if latest.as_ref().is_some_and(|last| point.ts < last.ts) {
            continue;
        }
        if latest.as_ref().is_none_or(|last| !same_level(last, point)) {
            changed.push(point.clone());
        }
        latest = Some(point.clone());
    }
    if let Some(latest) = latest {
        checkpoint.quotas.insert(account.account_id.clone(), latest);
    }
    changed
}

fn group_minutes(samples: &[UsageSample]) -> Vec<UsageMinute> {
    let mut minutes = BTreeMap::<u64, BTreeMap<u64, (u64, f64)>>::new();
    for sample in samples {
        let minute = sample.ts / MINUTE_SECONDS * MINUTE_SECONDS;
        let seconds = minutes.entry(minute).or_default();
        let total = seconds.entry(sample.ts % MINUTE_SECONDS).or_default();
        total.0 = total.0.saturating_add(sample.tokens);
        total.1 += sample.cost_usd;
    }
    minutes
        .into_iter()
        .map(|(ts, seconds)| UsageMinute {
            ts,
            samples: seconds
                .into_iter()
                .map(|(offset, (tokens, cost))| (offset, tokens, cost))
                .collect(),
        })
        .collect()
}

fn account_batches(mut account: AccountReport) -> Vec<AccountReport> {
    let minutes = std::mem::take(&mut account.minutes);
    let quotas = std::mem::take(&mut account.quotas);
    let mut batches = Vec::new();
    for minutes in minutes.chunks(RECORD_BATCH_SIZE) {
        let mut batch = account.clone();
        batch.minutes = minutes.to_vec();
        batches.push(batch);
    }
    // Send quota observations only after their known token costs have been accepted.
    for quotas in quotas.chunks(RECORD_BATCH_SIZE) {
        let mut batch = account.clone();
        batch.quotas = quotas.to_vec();
        batches.push(batch);
    }
    if batches.is_empty() {
        batches.push(account);
    }
    batches
}

#[cfg(test)]
mod tests;
