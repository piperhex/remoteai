//! Optional cross-account distribution of packages selected by the GitHub updater.
//! Signaling carries opaque identifiers only; each transfer gets an isolated direct-only network.
mod android;
mod block_download;
mod block_plan;
mod block_protocol;
mod cache;
mod checkpoint;
pub(crate) mod commands;
mod dependency;
mod mirror;
mod network_cost;
mod origin_blocks;
pub(crate) mod packages;
mod parallel;
pub(crate) mod policy;
mod remote_policy;
mod reporting;
mod signaling;
mod snapshot;
mod transfer;

pub(crate) use checkpoint::shutdown as checkpoint_shutdown;
pub(crate) use signaling::{Bridge, Offer, Offers};

use std::{sync::Arc, time::Duration};
use tauri::Manager;
use tokio::sync::{mpsc, watch, Semaphore};

const MAX_PACKAGE_BYTES: usize = 512 * 1024 * 1024;
const MAX_UPLOADS: usize = 2;
const MAX_DOWNLOAD_PEERS: usize = 3;
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
    reporter: Option<reporting::Reporter>,
    cache: Arc<cache::Cache>,
    broker: watch::Sender<Option<mpsc::Sender<signaling::Request>>>,
    uploads: Arc<Semaphore>,
    downloads: Semaphore,
    policy: Arc<policy::Policy>,
    mirror_base: watch::Sender<Option<String>>,
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
    let service = Arc::new(Service {
        reporter: Some(reporting::reporter(app)),
        cache: cache.clone(),
        broker: watch::channel(None).0,
        uploads: Arc::new(Semaphore::new(MAX_UPLOADS)),
        downloads: Semaphore::new(1),
        policy: policy::Policy::new(),
        mirror_base: watch::channel(None).0,
    });
    app.manage(service.clone());
    tauri::async_runtime::spawn(service.policy.clone().run());
    tauri::async_runtime::spawn(remote_policy::run(service.clone()));
    tauri::async_runtime::spawn(android::run(service));
    tauri::async_runtime::spawn(async move {
        if let Err(error) = cache.restore().await {
            eprintln!("could not restore update sharing cache: {error}");
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests;
