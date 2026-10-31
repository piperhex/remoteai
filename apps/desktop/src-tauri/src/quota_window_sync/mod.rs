//! Opt-in background activation of idle five-hour account windows.
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Runtime};

use crate::{models::UsageSummary, storage};

mod policy;
mod worker;

const CHECK_INTERVAL: Duration = Duration::from_secs(30);
static SWEEP: Mutex<SweepState> = Mutex::new(SweepState::new());

struct SweepState {
    running: bool,
    last_started: Option<Instant>,
}

impl SweepState {
    const fn new() -> Self {
        Self {
            running: false,
            last_started: None,
        }
    }

    fn begin(&mut self, now: Instant) -> bool {
        if self.running
            || self
                .last_started
                .is_some_and(|last| now.duration_since(last) < CHECK_INTERVAL)
        {
            return false;
        }
        self.running = true;
        self.last_started = Some(now);
        true
    }
}

struct SweepPermit;

impl Drop for SweepPermit {
    fn drop(&mut self) {
        match SWEEP.lock() {
            Ok(mut state) => state.running = false,
            Err(error) => eprintln!("Could not release quota window synchronization: {error}"),
        }
    }
}

/// The caller never waits for settings, account files, or network traffic.
pub(crate) fn observe_activity<R: Runtime>(app: &AppHandle<R>, source_id: &str) {
    let Some(mut state) = SWEEP.try_lock().ok() else {
        return;
    };
    if !state.begin(Instant::now()) {
        return;
    }
    drop(state);
    let permit = SweepPermit;
    let app = app.clone();
    let source_id = source_id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        if let Err(error) = worker::synchronize(&app, &source_id) {
            eprintln!("Quota window synchronization failed: {error}");
        }
    });
}

pub(crate) fn observe_usage<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    previous: &UsageSummary,
    current: &UsageSummary,
) {
    if policy::usage_increased(previous, current, chrono::Utc::now().timestamp()) {
        observe_activity(app, id);
    }
}

#[tauri::command]
pub(crate) async fn set_quota_window_sync_enabled<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<crate::models::AppSettings, String> {
    tauri::async_runtime::spawn_blocking(move || storage::update_quota_window_sync(&app, enabled))
        .await
        .map_err(|_| "settings.quotaWindowSync.saveError".to_string())?
}

#[cfg(test)]
mod tests;
