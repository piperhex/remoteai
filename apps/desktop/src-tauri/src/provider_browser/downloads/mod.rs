//! Browser-owned transfers use the application's download list without re-fetching blob URLs.
mod files;
#[cfg(all(test, windows))]
mod smoke;
#[cfg(windows)]
pub(super) mod windows;

use serde::{Deserialize, Serialize};
use tauri::{Manager, Webview};

#[derive(Debug, thiserror::Error)]
pub(super) enum Error {
    #[error("client.downloads.browser.unavailable")]
    Unavailable,
    #[error("market.invalid")]
    Invalid,
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    id: String,
    name: String,
    origin: String,
    status: Status,
    received: u64,
    size: u64,
    created_at: u64,
    awaiting_confirmation: bool,
    can_resume: bool,
    sequence: u64,
}

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Status {
    Paused,
    Downloading,
    Completed,
    Failed,
}

impl Snapshot {
    #[cfg(windows)]
    fn new(id: String, path: &std::path::Path, uri: &str, pending: bool) -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};
        Self {
            id,
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            origin: url::Url::parse(uri.strip_prefix("blob:").unwrap_or(uri))
                .map(|url| url.origin().ascii_serialization())
                .unwrap_or_default(),
            status: if pending {
                Status::Paused
            } else {
                Status::Downloading
            },
            received: 0,
            size: 0,
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            awaiting_confirmation: pending,
            can_resume: true,
            sequence: 0,
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Action {
    #[serde(rename = "action")]
    Toggle,
    Pause,
    Resume,
    Retry,
    Remove,
    Open,
    Reveal,
}

fn insecure(url: &str) -> bool {
    let value = url.strip_prefix("blob:").unwrap_or(url);
    url::Url::parse(value).is_ok_and(|url| url.scheme() == "http")
}

#[tauri::command]
pub(crate) async fn browser_downloads(
    webview: Webview,
) -> std::result::Result<Vec<Snapshot>, String> {
    if webview.label() != "main" {
        return Err(Error::Invalid.to_string());
    }
    #[cfg(windows)]
    return windows::list(webview.app_handle())
        .await
        .map_err(|error| error.to_string());
    #[cfg(not(windows))]
    Ok(Vec::new())
}

#[tauri::command]
pub(crate) async fn browser_download_action(
    webview: Webview,
    id: String,
    action: Action,
) -> std::result::Result<(), String> {
    if webview.label() != "main" || uuid::Uuid::parse_str(&id).is_err() {
        return Err(Error::Invalid.to_string());
    }
    let app = webview.app_handle().clone();
    if matches!(action, Action::Open | Action::Reveal) {
        #[cfg(windows)]
        let path = windows::completed_path(&app, id.clone())
            .await
            .map_err(|error| error.to_string())?;
        #[cfg(not(windows))]
        let path = None;
        return tauri::async_runtime::spawn_blocking(move || files::open(&app, &id, action, path))
            .await
            .map_err(|_| Error::Unavailable.to_string())?
            .map_err(|error| error.to_string());
    }
    #[cfg(windows)]
    return windows::control(&app, id, action)
        .await
        .map_err(|error| error.to_string());
    #[cfg(not(windows))]
    Err(Error::Unavailable.to_string())
}

#[cfg(test)]
mod tests {
    use super::insecure;
    #[test]
    fn http_and_http_blobs_require_individual_confirmation() {
        for url in [
            "http://172.16.200.97:8019/file.apk",
            "blob:http://172.16.200.97:8019/id",
        ] {
            assert!(insecure(url));
        }
        for url in [
            "https://example.com/file.apk",
            "blob:https://example.com/id",
            "data:text/plain,hello",
        ] {
            assert!(!insecure(url));
        }
    }
}
