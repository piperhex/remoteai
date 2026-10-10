use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{watch, Mutex};

use super::{Error, Result, MAX_PACKAGE_BYTES};

const MAX_CACHED_PACKAGES: usize = 2;
const CACHE_LIFETIME: Duration = Duration::from_secs(14 * 24 * 60 * 60);
const MAX_INDEX_BYTES: u64 = 32 * 1024;

#[cfg(test)]
#[path = "cache_tests.rs"]
mod tests;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(super) struct Artifact {
    pub id: String,
    signature: String,
    version: String,
    target: String,
    url: String,
    pub size: usize,
    saved_at: u64,
}

impl Artifact {
    pub(super) fn android(
        version: String,
        url: String,
        digest: String,
        size: usize,
    ) -> Result<Self> {
        let hash = digest.strip_prefix("sha256:").ok_or(Error::Invalid)?;
        if !valid_id(hash)
            || !super::android::official_url(&url)
            || size == 0
            || size > MAX_PACKAGE_BYTES
        {
            return Err(Error::Invalid);
        }
        let mut artifact = Self {
            id: String::new(),
            signature: digest,
            version,
            target: "android".into(),
            url,
            size,
            saved_at: 0,
        };
        artifact.id = artifact.identity();
        Ok(artifact)
    }

    pub fn from_update(update: &tauri_plugin_updater::Update) -> Self {
        let mut artifact = Self {
            id: String::new(),
            signature: update.signature.clone(),
            version: update.version.clone(),
            target: update.target.clone(),
            url: update.download_url.to_string(),
            size: 0,
            saved_at: 0,
        };
        artifact.id = artifact.identity();
        artifact
    }

    fn identity(&self) -> String {
        let mut digest = Sha256::new();
        for value in [&self.signature, &self.version, &self.target, &self.url] {
            digest.update((value.len() as u64).to_be_bytes());
            digest.update(value.as_bytes());
        }
        format!("{:x}", digest.finalize())
    }

    fn valid(&self) -> bool {
        valid_id(&self.id)
            && self.id == self.identity()
            && self.size > 0
            && self.size <= MAX_PACKAGE_BYTES
            && self.saved_at <= now()
            && now().saturating_sub(self.saved_at) < CACHE_LIFETIME.as_secs()
    }

    pub fn verify(&self, bytes: &[u8], key: &str) -> Result<()> {
        if bytes.is_empty() || bytes.len() > MAX_PACKAGE_BYTES {
            return Err(Error::Invalid);
        }
        if self.target == "android" {
            let hash = self
                .signature
                .strip_prefix("sha256:")
                .ok_or(Error::Invalid)?;
            if !super::android::official_url(&self.url)
                || bytes.len() != self.size
                || !valid_id(hash)
                || format!("{:x}", Sha256::digest(bytes)) != hash
            {
                return Err(Error::Invalid);
            }
            return Ok(());
        }
        let decode = |value: &str| {
            String::from_utf8(STANDARD.decode(value).map_err(|_| Error::Invalid)?)
                .map_err(|_| Error::Invalid)
        };
        let key = minisign_verify::PublicKey::decode(&decode(key)?).map_err(|_| Error::Invalid)?;
        let signature = minisign_verify::Signature::decode(&decode(&self.signature)?)
            .map_err(|_| Error::Invalid)?;
        key.verify(bytes, &signature, true)
            .map_err(|_| Error::Invalid)
    }
}

pub(super) fn valid_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(super) struct Cache {
    root: PathBuf,
    pub key: String,
    index: watch::Sender<Vec<Artifact>>,
    // Serialize complete disk operations, including restore, eviction and publication.
    gate: Mutex<()>,
}

impl Cache {
    pub fn new(root: PathBuf, key: String) -> Self {
        Self {
            root,
            key,
            index: watch::channel(Vec::new()).0,
            gate: Mutex::new(()),
        }
    }

    pub fn artifacts(&self) -> Vec<Artifact> {
        self.index
            .borrow()
            .iter()
            .filter(|artifact| artifact.valid())
            .cloned()
            .collect()
    }

    pub async fn restore(self: &Arc<Self>) -> Result<()> {
        let _guard = self.gate.lock().await;
        let cache = self.clone();
        tokio::task::spawn_blocking(move || {
            fs::create_dir_all(&cache.root)?;
            let index_path = cache.root.join("index.json");
            let records: Vec<Artifact> = match fs::metadata(&index_path) {
                Ok(metadata) if metadata.len() <= MAX_INDEX_BYTES => {
                    serde_json::from_slice(&fs::read(index_path)?).unwrap_or_default()
                }
                _ => Vec::new(),
            };
            let records: Vec<_> = records
                .into_iter()
                .filter(|record| record.valid())
                .take(MAX_CACHED_PACKAGES + 1)
                .filter(|record| cache.read_verified(record).is_ok())
                .collect();
            cache.remove_unused(&records)?;
            cache.index.send_replace(records);
            Ok(())
        })
        .await
        .map_err(|_| Error::Unavailable)?
    }

    pub async fn read(self: &Arc<Self>, id: &str) -> Result<Vec<u8>> {
        let _guard = self.gate.lock().await;
        let artifact = self
            .artifacts()
            .into_iter()
            .find(|record| record.id == id)
            .ok_or(Error::Unavailable)?;
        let cache = self.clone();
        tokio::task::spawn_blocking(move || {
            let result = cache.read_verified(&artifact);
            if result.is_err() {
                let records = cache
                    .artifacts()
                    .into_iter()
                    .filter(|record| record.id != artifact.id)
                    .collect();
                cache.index.send_replace(records);
            }
            result
        })
        .await
        .map_err(|_| Error::Unavailable)?
    }

    fn read_verified(&self, artifact: &Artifact) -> Result<Vec<u8>> {
        if !artifact.valid() {
            return Err(Error::Invalid);
        }
        let path = self.root.join(format!("{}.pkg", artifact.id));
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.is_file() || metadata.len() != artifact.size as u64 {
            return Err(Error::Invalid);
        }
        let bytes = fs::read(path)?;
        artifact.verify(&bytes, &self.key)?;
        Ok(bytes)
    }

    pub async fn save(self: &Arc<Self>, mut artifact: Artifact, bytes: Arc<Vec<u8>>) -> Result<()> {
        let _guard = self.gate.lock().await;
        let cache = self.clone();
        tokio::task::spawn_blocking(move || {
            artifact.verify(&bytes, &cache.key)?;
            artifact.size = bytes.len();
            artifact.saved_at = now();
            fs::create_dir_all(&cache.root)?;
            let mut records = cache.artifacts();
            records.retain(|record| record.id != artifact.id);
            records.insert(0, artifact.clone());
            let (mut desktop, mut android) = (0, 0);
            records.retain(|record| {
                if record.target == "android" {
                    android += 1;
                    android <= 1
                } else {
                    desktop += 1;
                    desktop <= MAX_CACHED_PACKAGES
                }
            });
            // Evict older releases before publishing a replacement; temporary writes are never advertised.
            cache.remove_unused(&records)?;
            cache.atomic_write(&format!("{}.pkg", artifact.id), &bytes)?;
            let index = serde_json::to_vec(&records).map_err(|_| Error::Invalid)?;
            cache.atomic_write("index.json", &index)?;
            cache.index.send_replace(records);
            Ok(())
        })
        .await
        .map_err(|_| Error::Unavailable)?
    }

    fn atomic_write(&self, name: &str, bytes: &[u8]) -> Result<()> {
        let mut temporary = tempfile::NamedTempFile::new_in(&self.root)?;
        temporary.write_all(bytes)?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(self.root.join(name))
            .map_err(|error| error.error)?;
        Ok(())
    }

    fn remove_unused(&self, records: &[Artifact]) -> Result<()> {
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".pkg")) else {
                continue;
            };
            if valid_id(id) && !records.iter().any(|record| record.id == id) {
                fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
}
