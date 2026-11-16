use std::{io::Read, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::{blocking::Client, redirect::Policy, Url};
use serde::Deserialize;

const MAX_CATALOG_BYTES: u64 = 32 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
const CATALOG_TIMEOUT: Duration = Duration::from_secs(30);
const ARCHIVE_TIMEOUT: Duration = Duration::from_secs(120);
const UNAVAILABLE: &str = "market.extensionsDownloadFailed";

#[derive(Debug, thiserror::Error)]
enum MarketError {
    #[error("Invalid marketplace request")]
    InvalidRequest,
    #[error("Marketplace request failed")]
    Request(#[from] reqwest::Error),
    #[error("Could not read marketplace response")]
    Read(#[from] std::io::Error),
    #[error("Invalid marketplace response")]
    InvalidResponse,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MarketArchive {
    id: String,
    sha256: String,
    size: u64,
}

fn endpoint(base: &str, archive: Option<&MarketArchive>) -> Result<Url, MarketError> {
    let mut url = Url::parse(base).map_err(|_| MarketError::InvalidRequest)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(MarketError::InvalidRequest);
    }
    let prefix = format!("{}/browser-extensions", url.path().trim_end_matches('/'));
    url.set_path(&prefix);
    if let Some(archive) = archive {
        let id = uuid::Uuid::parse_str(&archive.id).map_err(|_| MarketError::InvalidRequest)?;
        if id.to_string() != archive.id
            || archive.sha256.len() != 64
            || !archive
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || archive.size == 0
            || archive.size > MAX_ARCHIVE_BYTES
        {
            return Err(MarketError::InvalidRequest);
        }
        url.set_path(&format!("{prefix}/{id}/archive"));
        url.query_pairs_mut().append_pair("sha256", &archive.sha256);
    }
    Ok(url)
}

fn read_response(
    response: reqwest::blocking::Response,
    limit: u64,
) -> Result<Vec<u8>, MarketError> {
    if !response.status().is_success() || response.content_length().is_some_and(|size| size > limit)
    {
        return Err(MarketError::InvalidResponse);
    }
    let mut bytes = Vec::new();
    response.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(MarketError::InvalidResponse);
    }
    Ok(bytes)
}

fn load(base: &str, archive: Option<&MarketArchive>) -> Result<String, MarketError> {
    let url = endpoint(base, archive)?;
    let timeout = if archive.is_some() {
        ARCHIVE_TIMEOUT
    } else {
        CATALOG_TIMEOUT
    };
    let client = crate::system_proxy::apply(Client::builder())
        .timeout(timeout)
        .redirect(Policy::none())
        .build()?;
    // Public metadata and packages never carry the account's credentials or follow redirects.
    let response = client
        .get(url)
        .header("Cache-Control", "no-cache, no-store")
        .send()?;
    let bytes = read_response(
        response,
        archive.map_or(MAX_CATALOG_BYTES, |item| item.size),
    )?;
    Ok(STANDARD.encode(bytes))
}

/// Fetch only marketplace resources off the UI thread, without relaxing the desktop CSP.
#[tauri::command]
pub(crate) async fn fetch_browser_extension_market(
    base_url: String,
    archive: Option<MarketArchive>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || load(&base_url, archive.as_ref()))
        .await
        .map_err(|_| UNAVAILABLE.to_string())?
        .map_err(|_| UNAVAILABLE.to_string())
}

#[cfg(test)]
mod tests;
