//! Complete, checksum-verified navigation-browser home packages. No background polling.
mod package;
mod server;
mod storage;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod ui_fixture;

use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, sync::Mutex};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, thiserror::Error)]
pub(super) enum Error {
    #[error("browser home unavailable")]
    Unavailable,
    #[error("invalid browser home package")]
    Invalid,
    #[error("browser home cache unavailable")]
    Cache,
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Default)]
pub(crate) struct State {
    runtime: Mutex<VecDeque<server::HomeServer>>,
    updating: tokio::sync::Mutex<()>,
}

#[derive(Clone, Serialize)]
pub(crate) struct View {
    md5: String,
    url: String,
}

#[derive(Deserialize)]
struct Configuration {
    enabled: bool,
    #[serde(default)]
    md5: String,
}

#[tauri::command]
pub(crate) async fn browser_home_cached<R: Runtime>(
    app: AppHandle<R>,
) -> std::result::Result<Option<View>, String> {
    tauri::async_runtime::spawn_blocking(move || cached(&app))
        .await
        .map_err(|_| "browser-home-unavailable".to_owned())?
        .map_err(|_| "browser-home-unavailable".to_owned())
}

#[tauri::command]
pub(crate) async fn browser_home_check<R: Runtime>(
    app: AppHandle<R>,
) -> std::result::Result<Option<View>, String> {
    let state = app.state::<State>();
    let _update = state.updating.lock().await;
    let worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || check(&worker))
        .await
        .map_err(|_| "browser-home-unavailable".to_owned())?
        .map_err(|_| "browser-home-unavailable".to_owned())
}

fn cached<R: Runtime>(app: &AppHandle<R>) -> Result<Option<View>> {
    let cache = storage::Cache::for_app(app)?;
    let Some(current) = cache.current()? else {
        return Ok(None);
    };
    if !current.enabled {
        return Ok(None);
    }
    show(app, &cache, &current.md5).map(Some)
}

fn check<R: Runtime>(app: &AppHandle<R>) -> Result<Option<View>> {
    let cache = storage::Cache::for_app(app)?;
    match refresh(&cache)? {
        Some(md5) => show(app, &cache, &md5).map(Some),
        None => Ok(None),
    }
}

fn refresh(cache: &storage::Cache) -> Result<Option<String>> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|_| Error::Unavailable)?;
    let config: Configuration = client
        .get(format!("{}/browser-home/current", cache.base))
        .send()
        .map_err(|_| Error::Unavailable)?
        .error_for_status()
        .map_err(|_| Error::Unavailable)?
        .json()
        .map_err(|_| Error::Invalid)?;
    if !config.enabled {
        cache.disable()?;
        return Ok(None);
    }
    if !package::valid_digest(&config.md5) {
        return Err(Error::Invalid);
    }
    if cache.read(&config.md5).is_err() {
        let response = client
            .get(format!(
                "{}/browser-home/packages/{}",
                cache.base, config.md5
            ))
            .send()
            .map_err(|_| Error::Unavailable)?
            .error_for_status()
            .map_err(|_| Error::Unavailable)?;
        let bytes = package::read_limited(response)?;
        package::decode(&bytes, &config.md5)?;
        cache.save(&config.md5, &bytes)?;
    }
    cache.activate(&config.md5)?;
    Ok(Some(config.md5))
}

fn show<R: Runtime>(app: &AppHandle<R>, cache: &storage::Cache, md5: &str) -> Result<View> {
    let state = app.state::<State>();
    {
        let runtime = state.runtime.lock().map_err(|_| Error::Cache)?;
        if let Some(server) = runtime
            .iter()
            .find(|s| s.base == cache.base && s.md5 == md5)
        {
            return Ok(server.view());
        }
    }
    let home = cache.read(md5)?;
    let server = server::HomeServer::start(cache.base.clone(), md5.to_owned(), home)?;
    let view = server.view();
    let mut runtime = state.runtime.lock().map_err(|_| Error::Cache)?;
    runtime.push_front(server);
    // The previous page can still request lazy assets while its replacement is loading.
    runtime.truncate(2);
    Ok(view)
}

pub(crate) fn respond_hosted<R: Runtime>(app: &AppHandle<R>, request: tiny_http::Request) {
    let home = app
        .state::<State>()
        .runtime
        .lock()
        .ok()
        .and_then(|runtime| {
            runtime
                .iter()
                .find(|server| {
                    request
                        .url()
                        .starts_with(&format!("/browser-home/site/{}/", server.home.revision))
                })
                .map(|server| server.home.clone())
        });
    server::respond(request, home.as_deref(), None);
}
