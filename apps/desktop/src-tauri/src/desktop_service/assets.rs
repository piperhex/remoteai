//! The installed runtime must match the hashes embedded in this executable at build time.
use super::{Result, ServiceError};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read, path::Path, sync::OnceLock};

const MANIFEST: &str = include_str!(concat!(env!("OUT_DIR"), "/desktop-service-manifest.json"));
static EXECUTABLE_FINGERPRINT: OnceLock<String> = OnceLock::new();

/// Identifies the running build, including same-version rebuilds. Call only from a blocking worker.
pub(super) fn executable_fingerprint() -> Result<String> {
    if let Some(fingerprint) = EXECUTABLE_FINGERPRINT.get() {
        return Ok(fingerprint.clone());
    }
    let executable = std::env::current_exe().map_err(|_| ServiceError::Setup)?;
    let fingerprint = file_fingerprint(&executable)?;
    Ok(EXECUTABLE_FINGERPRINT.get_or_init(|| fingerprint).clone())
}

fn file_fingerprint(path: &Path) -> Result<String> {
    let mut file = std::fs::File::open(path).map_err(|_| ServiceError::Setup)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let length = file.read(&mut buffer).map_err(|_| ServiceError::Setup)?;
        if length == 0 {
            break;
        }
        hash.update(&buffer[..length]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub(super) fn ready() -> bool {
    serde_json::from_str::<BTreeMap<String, String>>(MANIFEST).is_ok_and(|entries| {
        entries.contains_key("resources/desktop-service/node.exe")
            && entries.contains_key("resources/desktop-service/host.mjs")
    })
}
pub(super) fn verify(root: &Path) -> Result<()> {
    if !ready() {
        return Err(ServiceError::Setup);
    }
    let entries: BTreeMap<String, String> =
        serde_json::from_str(MANIFEST).map_err(|_| ServiceError::Setup)?;
    for directory in ["resources/desktop-service", "resources/remote-desktop"] {
        check_tree(root, &root.join(directory), &entries)?;
    }
    for (relative, expected) in entries {
        let path = root.join(relative);
        if file_fingerprint(&path)? != expected {
            return Err(ServiceError::Setup);
        }
    }
    Ok(())
}

fn check_tree(root: &Path, directory: &Path, entries: &BTreeMap<String, String>) -> Result<()> {
    use std::os::windows::fs::MetadataExt;
    let metadata = std::fs::symlink_metadata(directory).map_err(|_| ServiceError::Setup)?;
    if metadata.file_attributes() & 0x400 != 0 {
        return Err(ServiceError::Invalid);
    }
    for entry in std::fs::read_dir(directory).map_err(|_| ServiceError::Setup)? {
        let path = entry.map_err(|_| ServiceError::Setup)?.path();
        let metadata = std::fs::symlink_metadata(&path).map_err(|_| ServiceError::Setup)?;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(ServiceError::Invalid);
        }
        if metadata.is_dir() {
            check_tree(root, &path, entries)?;
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| ServiceError::Invalid)?
            .to_string_lossy()
            .replace('\\', "/");
        if !entries.contains_key(&relative) {
            return Err(ServiceError::Setup);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_tracks_content_instead_of_path_or_file_size() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.exe");
        let installed = directory.path().join("installed.exe");
        let bytes = vec![7; 65537];
        std::fs::write(&source, &bytes).unwrap();
        std::fs::copy(&source, &installed).unwrap();
        assert_eq!(
            file_fingerprint(&source).unwrap(),
            file_fingerprint(&installed).unwrap()
        );
        let mut rebuilt = bytes;
        rebuilt[65536] = 8;
        std::fs::write(&installed, rebuilt).unwrap();
        assert_ne!(
            file_fingerprint(&source).unwrap(),
            file_fingerprint(&installed).unwrap()
        );
        assert!(file_fingerprint(&directory.path().join("missing.exe")).is_err());
    }
}
