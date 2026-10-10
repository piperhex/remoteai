//! Optional cross-account distribution of packages selected by the GitHub updater.
//! Signaling carries opaque identifiers only; each transfer gets an isolated direct-only network.
mod cache;
pub(crate) mod commands;
mod signaling;
mod transfer;

pub(crate) use signaling::{Bridge, Offer};

use std::{sync::Arc, time::Duration};
use tauri::Manager;
use tokio::sync::{mpsc, watch, Semaphore};

const MAX_PACKAGE_BYTES: usize = 512 * 1024 * 1024;
const MAX_UPLOADS: usize = 2;
const TRANSFER_LIFETIME: Duration = Duration::from_secs(20 * 60);

#[derive(Debug, thiserror::Error)]
enum Error {
    #[error("Update peer is unavailable")]
    Unavailable,
    #[error("Invalid update package")]
    Invalid,
    #[error("Update cache is unavailable")]
    Io(#[from] std::io::Error),
    #[error("Update transfer interrupted")]
    Network(#[from] csw_chat_connectivity::Error),
}
type Result<T> = std::result::Result<T, Error>;

pub(crate) struct Service {
    cache: Arc<cache::Cache>,
    broker: watch::Sender<Option<mpsc::Sender<signaling::Request>>>,
    uploads: Arc<Semaphore>,
    downloads: Semaphore,
}

pub(crate) fn setup<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_owned();
    let cache = Arc::new(cache::Cache::new(
        app.path().app_cache_dir()?.join("update-peers"),
        key,
    ));
    app.manage(Arc::new(Service {
        cache: cache.clone(),
        broker: watch::channel(None).0,
        uploads: Arc::new(Semaphore::new(MAX_UPLOADS)),
        downloads: Semaphore::new(1),
    }));
    tauri::async_runtime::spawn(async move {
        if let Err(error) = cache.restore().await {
            eprintln!("could not restore update sharing cache: {error}");
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests;
