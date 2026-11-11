//! Elevation executes only the pinned release bytes, not merely files with expected names.
use super::super::{package, platform, ComputerError, Result, VERSION};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{File, OpenOptions},
    io::Read,
    os::windows::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};
use windows_sys::Win32::Storage::FileSystem::{FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_READ};

#[derive(serde::Deserialize)]
struct Manifest {
    version: String,
    targets: BTreeMap<String, BTreeMap<String, String>>,
}

pub(super) struct Package {
    pub executable: PathBuf,
    _files: Vec<File>,
    _directory: File,
}

pub(super) fn lock(root: &Path) -> Result<Package> {
    let manifest: Manifest = serde_json::from_str(include_str!("windows-files.json"))
        .map_err(|_| ComputerError::Integrity)?;
    if manifest.version != VERSION {
        return Err(ComputerError::Integrity);
    }
    let asset = platform::asset()?;
    let files = manifest
        .targets
        .get(asset.target)
        .ok_or(ComputerError::Integrity)?;
    if files.len() != asset.files.len() {
        return Err(ComputerError::Integrity);
    }
    let directory = package::directory(root)?
        .canonicalize()
        .map_err(|_| ComputerError::Integrity)?;
    let directory_handle = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(&directory)
        .map_err(|_| ComputerError::Integrity)?;
    let files = asset
        .files
        .iter()
        .map(|name| {
            let expected = files.get(*name).ok_or(ComputerError::Integrity)?;
            lock_file(&directory.join(name), expected)
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Package {
        executable: directory.join(asset.executable()),
        _files: files,
        _directory: directory_handle,
    })
}

fn lock_file(path: &Path, expected: &str) -> Result<File> {
    let mut file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
        .map_err(|_| ComputerError::Integrity)?;
    let mut hash = Sha256::new();
    const HASH_BUFFER_BYTES: usize = 64 * 1024;
    let mut buffer = [0u8; HASH_BUFFER_BYTES];
    loop {
        let size = file
            .read(&mut buffer)
            .map_err(|_| ComputerError::Integrity)?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    if format!("{:x}", hash.finalize()) != expected {
        return Err(ComputerError::Integrity);
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_windows_architectures_have_complete_version_matched_hashes() {
        let manifest: Manifest = serde_json::from_str(include_str!("windows-files.json")).unwrap();
        assert_eq!(manifest.version, VERSION);
        for architecture in ["x86_64", "aarch64"] {
            let asset = super::super::super::assets::select("windows", architecture).unwrap();
            let files = &manifest.targets[asset.target];
            assert_eq!(files.len(), asset.files.len());
            for name in asset.files {
                assert_eq!(files[*name].len(), 64);
                assert!(files[*name].bytes().all(|byte| byte.is_ascii_hexdigit()));
            }
        }
    }

    #[test]
    fn verified_file_handles_prevent_changes_until_authorization_ends() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("binary.exe");
        std::fs::write(&path, "verified").unwrap();
        let file = lock_file(&path, &format!("{:x}", Sha256::digest(b"verified"))).unwrap();
        assert!(std::fs::write(&path, "changed").is_err());
        assert!(std::fs::remove_file(&path).is_err());
        drop(file);
        std::fs::write(&path, "changed").unwrap();
        assert!(lock_file(&path, &format!("{:x}", Sha256::digest(b"verified"))).is_err());
    }
}
