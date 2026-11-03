use super::{summary, *};
use std::{collections::HashMap, time::Instant};

const REFRESH_INTERVAL: Duration = Duration::from_secs(60);
const TOTALS_LOOKBACK_SECONDS: i64 = 24 * 60 * 60;
static CACHE: Mutex<QuotaCache> = Mutex::new(QuotaCache::new());

/// Both amounts come from the same limiting window used by the PC account view.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EstimatedOfficialQuota {
    pub(crate) remaining_usd: f64,
    pub(crate) capacity_usd: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct QuotaScope {
    base_url: String,
    user_id: String,
}

impl QuotaScope {
    pub(super) fn from_settings(settings: &AppSettings) -> Option<Self> {
        Some(Self {
            base_url: settings.cloud_base_url.clone()?,
            user_id: settings.cloud_user_id.clone()?,
        })
    }
}

struct QuotaCache {
    scope: Option<QuotaScope>,
    running: bool,
    attempted: Option<Instant>,
    quotas: Option<HashMap<String, EstimatedOfficialQuota>>,
}

impl QuotaCache {
    const fn new() -> Self {
        Self {
            scope: None,
            running: false,
            attempted: None,
            quotas: None,
        }
    }

    fn select(&mut self, scope: &QuotaScope, now: Instant) -> bool {
        if self.scope.as_ref() != Some(scope) {
            *self = Self {
                scope: Some(scope.clone()),
                ..Self::new()
            };
        }
        if self.running
            || self
                .attempted
                .is_some_and(|at| now.duration_since(at) < REFRESH_INTERVAL)
        {
            return false;
        }
        self.running = true;
        self.attempted = Some(now);
        true
    }

    fn finish(
        &mut self,
        scope: &QuotaScope,
        attempted: Instant,
        result: Option<HashMap<String, EstimatedOfficialQuota>>,
    ) {
        // Returning to the same account must not accept an earlier request's result.
        if self.scope.as_ref() == Some(scope) && self.attempted == Some(attempted) {
            self.running = false;
            self.quotas = result;
        }
    }

    fn selected(&self, ids: &[String]) -> Option<EstimatedOfficialQuota> {
        let quotas = self.quotas.as_ref()?;
        let mut result = EstimatedOfficialQuota {
            remaining_usd: 0.0,
            capacity_usd: Some(0.0),
        };
        if ids.is_empty() {
            return None;
        }
        for id in ids {
            let value = quotas.get(id)?;
            result.remaining_usd += value.remaining_usd;
            result.capacity_usd = result
                .capacity_usd
                .zip(value.capacity_usd)
                .map(|(left, right)| left + right);
        }
        if !result.remaining_usd.is_finite()
            || result.capacity_usd.is_some_and(|value| !value.is_finite())
        {
            return None;
        }
        Some(result)
    }
}

/// Never waits on cloud requests; the five-second usage poll only copies a small cached estimate.
pub(crate) fn cached_official_quota(
    app: &tauri::AppHandle,
    account_ids: &[String],
) -> Option<EstimatedOfficialQuota> {
    if account_ids.is_empty() {
        return None;
    }
    let (settings, credentials) = cloud_snapshot(app).ok()?;
    if !cloud_state(&settings, &credentials).authenticated {
        return None;
    }
    let scope = QuotaScope::from_settings(&settings)?;
    let attempted = Instant::now();
    let (refresh, quota) = {
        let mut cache = CACHE.try_lock().ok()?;
        let refresh = cache.select(&scope, attempted);
        (refresh, cache.selected(account_ids))
    };
    if refresh {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            // Quotas ignore the totals' range. Keep that range short while tolerating clock skew.
            let start_ts = Utc::now()
                .timestamp()
                .saturating_sub(TOTALS_LOOKBACK_SECONDS)
                .max(0);
            let result = summary::load_summary(&app, start_ts, Some(&scope));
            let values = result
                .map(|value| value.available_quotas())
                .inspect_err(|error| {
                    eprintln!("Could not refresh chat quota estimates: {error}");
                })
                .ok();
            match CACHE.lock() {
                Ok(mut cache) => cache.finish(&scope, attempted, values),
                Err(error) => eprintln!("Could not store chat quota estimates: {error}"),
            }
        });
    }
    quota
}

#[cfg(test)]
#[path = "quota_cache_tests.rs"]
mod tests;
