use super::{
    super::{state, ComputerError, Result},
    native::Process,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct Lease {
    pub id: uuid::Uuid,
    pub generation: String,
    pub owner: u32,
    pub owner_started: u64,
    pub broker: u32,
    pub broker_started: u64,
}

fn path(root: &Path, home_id: &str) -> Result<PathBuf> {
    state::path(root, home_id)?; // Use exactly the managed Home identifier validation.
    Ok(root.join("administrator").join(format!("{home_id}.json")))
}

pub(super) fn read(root: &Path, home_id: &str) -> Result<Option<Lease>> {
    match fs::read(path(root, home_id)?) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| ComputerError::Administrator),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(ComputerError::Administrator),
    }
}

pub(super) fn save(root: &Path, home_id: &str, lease: &Lease) -> Result<()> {
    fs::create_dir_all(root.join("administrator")).map_err(|_| ComputerError::Storage)?;
    let value = serde_json::to_value(lease).map_err(|_| ComputerError::Storage)?;
    crate::storage::write_json_atomic(&path(root, home_id)?, &value)
        .map_err(|_| ComputerError::Storage)
}

pub(super) fn remove(root: &Path, home_id: &str) -> Result<()> {
    match fs::remove_file(path(root, home_id)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ComputerError::Storage),
    }
}

pub(super) fn active(root: &Path, home_id: &str) -> Option<Lease> {
    let lease = read(root, home_id).ok()??;
    let record = state::read(root, home_id).ok()??;
    if !record.enabled || !record.administrator || record.generation != lease.generation {
        return None;
    }
    let owner = Process::open(lease.owner).ok()?;
    let broker = Process::open(lease.broker).ok()?;
    owner.trusted().ok()?;
    broker.trusted().ok()?;
    (owner.alive()
        && broker.alive()
        && broker.elevated().ok()?
        && owner.started().ok()? == lease.owner_started
        && broker.started().ok()? == lease.broker_started)
        .then_some(lease)
}

pub(super) fn matches(root: &Path, home_id: &str, expected: &Lease) -> bool {
    state::read(root, home_id)
        .ok()
        .flatten()
        .is_some_and(|record| {
            record.enabled && record.administrator && record.generation == expected.generation
        })
        && read(root, home_id)
            .ok()
            .flatten()
            .is_some_and(|lease| lease.id == expected.id)
}
