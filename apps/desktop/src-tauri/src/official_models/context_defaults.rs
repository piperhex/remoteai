//! Recover original defaults without blocking settings reads or repeatedly refreshing offline.
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Runtime};

const RETRY_INTERVAL: Duration = Duration::from_secs(60);
static REFRESH_STATE: Mutex<RefreshState> = Mutex::new(RefreshState {
    running: false,
    last_attempt: None,
});

struct RefreshState {
    running: bool,
    last_attempt: Option<Instant>,
}

impl RefreshState {
    fn try_start(&mut self, now: Instant) -> bool {
        if self.running
            || self
                .last_attempt
                .is_some_and(|last| now.duration_since(last) < RETRY_INTERVAL)
        {
            return false;
        }
        self.running = true;
        self.last_attempt = Some(now);
        true
    }
}

struct RefreshPermit;

impl Drop for RefreshPermit {
    fn drop(&mut self) {
        match REFRESH_STATE.lock() {
            Ok(mut state) => state.running = false,
            Err(error) => eprintln!("Could not release context defaults refresh: {error}"),
        }
    }
}

fn reserve_refresh() -> Option<RefreshPermit> {
    match REFRESH_STATE.lock() {
        Ok(mut state) => {
            if state.try_start(Instant::now()) {
                Some(RefreshPermit)
            } else {
                None
            }
        }
        Err(error) => {
            eprintln!("Could not start context defaults refresh: {error}");
            None
        }
    }
}

/// Called by the settings worker only when no trustworthy original capacities have been saved.
pub(crate) fn request_context_defaults_refresh<R: Runtime + 'static>(app: AppHandle<R>) {
    let Some(permit) = reserve_refresh() else {
        return;
    };
    let result = std::thread::Builder::new()
        .name("official-context-defaults".to_owned())
        .spawn(move || {
            // Release the single-flight reservation on every exit, including a failed fetch.
            let _permit = permit;
            if crate::storage::resolve_paths(&app)
                .is_ok_and(|paths| !super::cached_context_windows(&paths).is_empty())
            {
                return;
            }
            if let Err(error) = super::refresh_official_model_catalog_blocking(&app) {
                eprintln!("Could not refresh original model context defaults: {error}");
            }
        });
    if let Err(error) = result {
        eprintln!("Could not spawn context defaults refresh: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refreshes_are_single_flight_and_offline_retries_are_throttled() {
        let now = Instant::now();
        let mut state = RefreshState {
            running: false,
            last_attempt: None,
        };
        assert!(state.try_start(now));
        assert!(!state.try_start(now + RETRY_INTERVAL));
        state.running = false;
        assert!(!state.try_start(now + RETRY_INTERVAL / 2));
        assert!(state.try_start(now + RETRY_INTERVAL));
    }
}
