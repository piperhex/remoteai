//! PCs keep one official Android APK available for mobile receivers.
use super::{cache::Artifact, Error, Result, Service, MAX_PACKAGE_BYTES};
use serde::Deserialize;
use std::{sync::Arc, time::Duration};

const RELEASE_API: &str = "https://api.github.com/repos/piperhex/remoteai/releases/latest";
const POLL_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const IDLE_DELAY: Duration = Duration::from_secs(60);

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
    size: usize,
}

pub(super) fn official_url(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("github.com")
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && url
                .path()
                .starts_with("/piperhex/remoteai/releases/download/")
            && url.path().ends_with(".apk")
    })
}

pub(super) async fn run(service: Arc<Service>) {
    loop {
        tokio::time::sleep(IDLE_DELAY).await;
        // Stay out of active update downloads/uploads and do not fetch while signed out.
        if service.broker.borrow().is_none()
            || service.downloads.available_permits() == 0
            || service.uploads.available_permits() < super::MAX_UPLOADS
        {
            continue;
        }
        if let Err(error) = cache_latest(&service).await {
            eprintln!("Android update sharing cache unavailable: {error}");
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

async fn cache_latest(service: &Arc<Service>) -> Result<()> {
    let client = reqwest::Client::builder()
        .user_agent("RemoteAI-UpdateSharing")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20 * 60))
        .build()
        .map_err(|_| Error::Unavailable)?;
    let response = client
        .get(RELEASE_API)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| Error::Unavailable)?
        .error_for_status()
        .map_err(|_| Error::Unavailable)?;
    let release: Release = response.json().await.map_err(|_| Error::Invalid)?;
    let version = release.tag_name.trim_start_matches('v');
    if semver::Version::parse(version).is_err() {
        return Err(Error::Invalid);
    }
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name.contains("android") && asset.name.ends_with(".apk"))
        .ok_or(Error::Unavailable)?;
    let artifact = Artifact::android(
        version.into(),
        asset.browser_download_url.clone(),
        asset.digest.ok_or(Error::Invalid)?,
        asset.size,
    )?;
    if service
        .cache
        .artifacts()
        .iter()
        .any(|cached| cached.id == artifact.id)
    {
        return Ok(());
    }
    let bytes = fetch_package(&client, &asset.browser_download_url, asset.size).await?;
    service.cache.save(artifact, Arc::new(bytes)).await
}

async fn fetch_package(client: &reqwest::Client, url: &str, size: usize) -> Result<Vec<u8>> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| Error::Unavailable)?
        .error_for_status()
        .map_err(|_| Error::Unavailable)?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Error::Unavailable)? {
        if bytes.len().saturating_add(chunk.len()) > size || size > MAX_PACKAGE_BYTES {
            return Err(Error::Invalid);
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() != size {
        return Err(Error::Invalid);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    #[test]
    fn android_packages_require_github_digest_and_the_official_repository() {
        let url = "https://github.com/piperhex/remoteai/releases/download/v1.0.0/android.apk";
        let digest = format!("sha256:{:x}", Sha256::digest(b"apk"));
        let artifact = Artifact::android("1.0.0".into(), url.into(), digest.clone(), 3).unwrap();
        artifact.verify(b"apk", "").unwrap();
        assert!(artifact.verify(b"bad", "").is_err());
        assert!(
            Artifact::android("1.0.0".into(), url.replace("piperhex", "other"), digest, 3).is_err()
        );
        assert!(!official_url(&url.replace("https:", "http:")));
    }
}
