use super::{ComputerError, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Deserialize, Serialize)]
pub(super) struct Record {
    pub home: PathBuf,
    pub enabled: bool,
    pub generation: String,
    /// Missing on legacy installations, which must adopt the app's pinned driver.
    #[serde(default)]
    pub version: String,
    /// Opt-in only. The live UAC authorization is separate and expires with the desktop process.
    #[serde(default)]
    pub administrator: bool,
}

pub(super) fn home_id(home: &Path) -> String {
    let path = home.to_string_lossy().replace('\\', "/");
    let path = if cfg!(windows) {
        path.to_lowercase()
    } else {
        path
    };
    format!(
        "{:x}",
        Sha256::digest(path.trim_end_matches('/').as_bytes())
    )
}

pub(super) fn path(root: &Path, id: &str) -> Result<PathBuf> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ComputerError::Disabled);
    }
    Ok(root.join("homes").join(format!("{id}.json")))
}

pub(super) fn read(root: &Path, id: &str) -> Result<Option<Record>> {
    let bytes = match fs::read(path(root, id)?) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(ComputerError::Storage),
    };
    let record: Record = serde_json::from_slice(&bytes).map_err(|_| ComputerError::Storage)?;
    if home_id(&record.home) != id {
        return Err(ComputerError::Disabled);
    }
    Ok(Some(record))
}

pub(super) fn save(root: &Path, record: &Record) -> Result<()> {
    fs::create_dir_all(root.join("homes")).map_err(|_| ComputerError::Storage)?;
    let value = serde_json::to_value(record).map_err(|_| ComputerError::Storage)?;
    crate::storage::write_json_atomic(&path(root, &home_id(&record.home))?, &value)
        .map_err(|_| ComputerError::Storage)
}

pub(super) fn allowed(root: &Path, id: &str, generation: &str) -> bool {
    matches!(read(root, id), Ok(Some(record)) if record.enabled && record.generation == generation)
}

/// Enumerate managed homes independently so one corrupt record cannot block other upgrades.
pub(super) fn installed_homes(root: &Path) -> Result<Vec<PathBuf>> {
    let entries = match fs::read_dir(root.join("homes")) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(ComputerError::Storage),
    };
    let mut homes = Vec::new();
    for entry in entries {
        let path = entry.map_err(|_| ComputerError::Storage)?.path();
        if path.extension().is_none_or(|extension| extension != "json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|name| name.to_str()) else {
            continue;
        };
        match read(root, id) {
            Ok(Some(record)) if record.enabled => homes.push(record.home),
            Ok(_) => {}
            Err(error) => eprintln!("Could not read computer-use upgrade record: {error}"),
        }
    }
    Ok(homes)
}
