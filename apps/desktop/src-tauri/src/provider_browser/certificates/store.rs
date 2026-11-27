use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub(super) struct Pin {
    pub fingerprint: String,
    reason: String,
}

impl Pin {
    pub(super) fn from_interstitial(pem: &str, reason: &str) -> Option<Self> {
        let encoded = pem
            .trim_start()
            .strip_prefix("-----BEGIN CERTIFICATE-----")?
            .split_once("-----END CERTIFICATE-----")?
            .0;
        if encoded.len() > 128 * 1024 || !reason.starts_with("net::ERR_CERT_") {
            return None;
        }
        let der = STANDARD
            .decode(encoded.split_ascii_whitespace().collect::<String>())
            .ok()?;
        if der.is_empty() {
            return None;
        }
        Some(Self {
            fingerprint: hex::encode_upper(Sha256::digest(der)),
            reason: reason.to_owned(),
        })
    }
}

pub(super) fn location(root: &Path, url: &url::Url, mapped: bool) -> PathBuf {
    let profile = if mapped { "mapped" } else { "regular" };
    root.join("browser-certificate-trust")
        .join(profile)
        .join(hex::encode(Sha256::digest(
            url.origin().ascii_serialization(),
        )))
}

pub(super) fn read(path: &Path) -> io::Result<Option<Pin>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

pub(super) fn remember(path: &Path, pin: &Pin) -> io::Result<()> {
    let dir = path.parent().ok_or(io::ErrorKind::InvalidInput)?;
    fs::create_dir_all(dir)?;
    let mut file = tempfile::NamedTempFile::new_in(dir)?;
    serde_json::to_writer(file.as_file_mut(), pin)?;
    file.as_file().sync_all()?;
    file.persist(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_decision_matches_the_leaf_error_and_https_origin() {
        let dir = tempfile::tempdir().unwrap();
        let url = url::Url::parse("https://test.local:8444/one").unwrap();
        let key = location(dir.path(), &url, false);
        assert_eq!(key, location(dir.path(), &url.join("/two").unwrap(), false));
        assert_ne!(key, location(dir.path(), &url, true));
        assert_ne!(
            key,
            location(
                dir.path(),
                &url::Url::parse("https://test.local/").unwrap(),
                false
            )
        );
        assert!(read(&key).unwrap().is_none());
        let chain = "-----BEGIN CERTIFICATE-----\nAQID\n-----END CERTIFICATE-----\n";
        let pin =
            Pin::from_interstitial(&chain.repeat(2), "net::ERR_CERT_AUTHORITY_INVALID").unwrap();
        assert_eq!(
            pin.fingerprint,
            hex::encode_upper(Sha256::digest([1, 2, 3]))
        );
        remember(&key, &pin).unwrap();
        assert_eq!(read(&key).unwrap().as_ref(), Some(&pin));
        let new_error = Pin::from_interstitial(chain, "net::ERR_CERT_DATE_INVALID").unwrap();
        assert_ne!(pin, new_error);
        let rotated = Pin::from_interstitial(&chain.replace("AQID", "BAUG"), &pin.reason).unwrap();
        remember(&key, &rotated).unwrap();
        assert_eq!(read(&key).unwrap(), Some(rotated));
    }
}
