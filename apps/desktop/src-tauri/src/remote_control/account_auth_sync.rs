//! Pull credential updates away from the control socket, without switching active accounts.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use tauri::Runtime;

const DOWNLOAD_ATTEMPTS: u64 = 3;

pub(super) fn receive<R: Runtime>(
    app: &tauri::AppHandle<R>,
    config: &crate::cloud::RemoteControlConfig,
    account_ids: Vec<String>,
) {
    let app = app.clone();
    let access_token = config.access_token.clone();
    tauri::async_runtime::spawn(async move {
        for id in account_ids.into_iter().filter(|id| valid_id(id)) {
            let key = format!("{}:{id}", access_token);
            let guard = PendingPull::acquire(&key);
            let Some(mut guard) = guard else { continue };
            loop {
                pull_with_retries(&app, &access_token, &id).await;
                if !guard.take_pending() {
                    break;
                }
            }
        }
    });
}

async fn pull_with_retries<R: Runtime>(app: &tauri::AppHandle<R>, access_token: &str, id: &str) {
    for attempt in 1..=DOWNLOAD_ATTEMPTS {
        match crate::cloud::pull_refreshed_account(app, access_token, id).await {
            Ok(()) => return,
            Err(error) => {
                eprintln!("Account credential download attempt {attempt} failed: {error}")
            }
        }
        if attempt < DOWNLOAD_ATTEMPTS {
            tokio::time::sleep(std::time::Duration::from_secs(attempt)).await;
        }
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 160
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

struct PendingPull(Option<String>);
static PENDING: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();

impl PendingPull {
    fn acquire(id: &str) -> Option<Self> {
        let mut pending = PENDING.get_or_init(Mutex::default).lock().ok()?;
        if let Some(again) = pending.get_mut(id) {
            *again = true;
            return None;
        }
        pending.insert(id.to_owned(), false);
        Some(Self(Some(id.to_owned())))
    }

    fn take_pending(&mut self) -> bool {
        let Some(id) = &self.0 else { return false };
        let Ok(mut pending) = PENDING.get_or_init(Mutex::default).lock() else {
            return false;
        };
        if pending.get_mut(id).is_some_and(std::mem::take) {
            return true;
        }
        pending.remove(id);
        self.0 = None;
        false
    }
}

impl Drop for PendingPull {
    fn drop(&mut self) {
        let Some(id) = &self.0 else { return };
        match PENDING.get_or_init(Mutex::default).lock() {
            Ok(mut pending) => {
                pending.remove(id);
            }
            Err(error) => eprintln!("Could not release credential download: {error}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coalesces_updates_without_losing_a_new_rotation_or_releasing_the_next_worker() {
        let id = uuid::Uuid::new_v4().to_string();
        let mut first = PendingPull::acquire(&id).unwrap();
        assert!(PendingPull::acquire(&id).is_none());
        assert!(first.take_pending());
        assert!(!first.take_pending());
        let second = PendingPull::acquire(&id).unwrap();
        drop(first);
        assert!(PendingPull::acquire(&id).is_none());
        drop(second);
        assert!(PendingPull::acquire(&id).is_some());
    }
}
