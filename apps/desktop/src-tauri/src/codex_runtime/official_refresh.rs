use std::time::Instant;

use serde::Serialize;

use super::{
    apply_model_refresh, fetch_model_refresh_catalog, model_refresh_from_value,
    model_retry::{retry_with_backoff, RetryOperations, RetryOutcome},
    upstream_model_refresh_reset, Duration, LoadedOfficialCatalog, ModelRefreshRequest, Ordering,
    CODEX_RUNTIME_APP, MODEL_REFRESH_GENERATION, OFFICIAL_MODEL_REFRESH_TIMEOUT,
};
use crate::{official_models, storage::Paths};
use tauri::Emitter;

const REFRESH_FAILED_EVENT: &str = "official-model-refresh-failed";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelRefreshFailure {
    using_cached_catalog: bool,
}

struct OfficialModelRetry {
    target: OfficialRefreshTarget,
    selected_model: String,
    started_at: Instant,
}

#[derive(Clone)]
struct OfficialRefreshTarget {
    generation: u64,
    account_id: String,
}

/// Applies the live official catalog, or its last successful snapshot while retrying in the background.
pub(super) fn refresh(generation: u64, selected_model: String) {
    let Some(account_id) = runtime_paths()
        .ok()
        .and_then(|paths| official_account_id(&paths))
    else {
        return;
    };
    let target = OfficialRefreshTarget {
        generation,
        account_id,
    };
    if !is_current(&target) {
        return;
    }
    match fetch_model_refresh_catalog(selected_model.clone(), OFFICIAL_MODEL_REFRESH_TIMEOUT) {
        Ok(loaded) => apply_success(&target, loaded),
        Err(error) => {
            crate::error_logs::record_proxy_error(
                &format!("Official model list update failed: {error}"),
                None,
            );
            eprintln!("Failed to load the official Codex model catalog: {error}");
            let retry = OfficialModelRetry {
                target,
                selected_model,
                started_at: Instant::now(),
            };
            let using_cached_catalog = apply_cached_catalog(&retry.target, &retry.selected_model);
            schedule_retry(retry, using_cached_catalog);
        }
    }
}

fn official_account_id(paths: &Paths) -> Option<String> {
    let state = crate::storage::read_state(paths);
    if state.active_provider_id.is_some() || state.active_provider_group.is_some() {
        return None;
    }
    state.active_account_id
}

fn is_current(target: &OfficialRefreshTarget) -> bool {
    MODEL_REFRESH_GENERATION.load(Ordering::Acquire) == target.generation
        && crate::local_proxy::is_running()
        && runtime_paths()
            .ok()
            .and_then(|paths| official_account_id(&paths))
            .is_some_and(|account_id| account_id == target.account_id)
}

fn runtime_paths() -> Result<Paths, String> {
    let app = CODEX_RUNTIME_APP
        .get()
        .ok_or_else(|| "Codex runtime is not initialized".to_string())?;
    crate::storage::resolve_paths(app)
}

fn apply_success(target: &OfficialRefreshTarget, loaded: LoadedOfficialCatalog) {
    if !is_current(target) {
        return;
    }
    let saved = runtime_paths().and_then(|paths| {
        official_models::save_source_catalog(
            &paths,
            official_models::OfficialCatalogUpdate {
                account_id: &target.account_id,
                catalog: loaded.catalog,
                etag: loaded.etag,
                client_version: &loaded.client_version,
                source: official_models::OfficialCatalogSource::LocalProxy,
            },
        )
    });
    if let Err(error) = saved {
        eprintln!("Failed to save the official Codex model catalog: {error}");
    }
    if is_current(target) {
        apply_model_refresh(target.generation, loaded.request);
    }
}

fn cached_request(paths: &Paths, selected_model: &str) -> Result<ModelRefreshRequest, String> {
    let catalog = official_models::cached_source_catalog(paths)?;
    model_refresh_from_value(&catalog, selected_model.to_string())
}

fn apply_cached_catalog(target: &OfficialRefreshTarget, selected_model: &str) -> bool {
    if !is_current(target) {
        return false;
    }
    let cached = runtime_paths().and_then(|paths| cached_request(&paths, selected_model));
    let (request, using_cached_catalog) = fallback_request(cached, selected_model);
    if is_current(target) {
        apply_model_refresh(target.generation, request);
    }
    using_cached_catalog
}

fn fallback_request(
    cached: Result<ModelRefreshRequest, String>,
    selected_model: &str,
) -> (ModelRefreshRequest, bool) {
    let using_cached_catalog = cached.is_ok();
    // With no previous success, remove the override instead of pinning the picker to one model.
    let request =
        cached.unwrap_or_else(|_| upstream_model_refresh_reset(selected_model.to_string()));
    (request, using_cached_catalog)
}

fn schedule_retry(mut retry: OfficialModelRetry, using_cached_catalog: bool) {
    if !retry.is_current() {
        return;
    }
    let target = retry.target.clone();
    let spawned = std::thread::Builder::new()
        .name("codex-official-model-retry".to_string())
        .spawn(move || match retry_with_backoff(&mut retry) {
            RetryOutcome::Succeeded(loaded) => apply_success(&retry.target, loaded),
            RetryOutcome::Cancelled => {}
            RetryOutcome::TimedOut => notify_failure(&retry.target, using_cached_catalog),
        });
    if let Err(error) = spawned {
        eprintln!("Failed to start the official Codex model retry: {error}");
        notify_failure(&target, using_cached_catalog);
    }
}

fn notify_failure(target: &OfficialRefreshTarget, using_cached_catalog: bool) {
    if !is_current(target) {
        return;
    }
    let Some(app) = CODEX_RUNTIME_APP.get() else {
        return;
    };
    if let Err(error) = app.emit(
        REFRESH_FAILED_EVENT,
        ModelRefreshFailure {
            using_cached_catalog,
        },
    ) {
        eprintln!("Failed to publish the official model refresh failure: {error}");
    }
}

impl RetryOperations for OfficialModelRetry {
    type Payload = LoadedOfficialCatalog;

    fn elapsed(&self) -> Duration {
        self.started_at.elapsed()
    }

    fn is_current(&self) -> bool {
        is_current(&self.target)
    }

    fn wait(&mut self, duration: Duration) {
        // Waiting and network I/O run on this worker, never on the UI or a polling callback.
        std::thread::sleep(duration);
    }

    fn fetch(&mut self, timeout: Duration) -> Result<Self::Payload, String> {
        let result = fetch_model_refresh_catalog(self.selected_model.clone(), timeout);
        if let Err(error) = &result {
            crate::error_logs::record_proxy_error(
                &format!("Official model list retry failed: {error}"),
                None,
            );
            eprintln!("Official Codex model catalog retry failed: {error}");
        }
        result
    }
}

#[cfg(test)]
mod tests;
