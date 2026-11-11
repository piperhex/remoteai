//! Explicit, per-Home UAC authorization, scoped to this desktop application lifetime.
mod broker;
mod lease;
mod native;
mod pipe;
#[cfg(debug_assertions)]
mod probe;
mod verified_package;
mod watch;

use super::{install, state, ComputerError, Result, CHANGES};
use serde::{Deserialize, Serialize};
#[cfg(debug_assertions)]
use std::path::PathBuf;
use std::{
    collections::HashSet,
    path::Path,
    sync::{LazyLock, Mutex},
};

const HELPER: &str = "--computer-use-administrator=";
static ATTEMPTED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
static PENDING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

struct Pending(String);
impl Drop for Pending {
    fn drop(&mut self) {
        match PENDING.lock() {
            Ok(mut pending) => {
                pending.remove(&self.0);
            }
            Err(_) => eprintln!("Could not release computer-use authorization guard"),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    requested: bool,
    active: bool,
    inherited: bool,
    attempted: bool,
}

#[derive(Serialize, Deserialize)]
struct Bootstrap {
    home_id: String,
    generation: String,
    #[cfg(debug_assertions)]
    root: PathBuf,
}

pub(super) fn status(root: &Path, home: &Path) -> Result<Status> {
    let id = state::home_id(home);
    let inherited = native::Process::open(std::process::id())?.elevated()?;
    Ok(Status {
        requested: state::read(root, &id)?.is_some_and(|record| record.administrator),
        active: inherited || lease::active(root, &id).is_some(),
        inherited,
        attempted: ATTEMPTED
            .lock()
            .map_err(|_| ComputerError::Storage)?
            .contains(&id),
    })
}

pub(super) fn revision(home: &Path) -> Option<String> {
    lease::active(&super::root().ok()?, &state::home_id(home)).map(|lease| lease.id.to_string())
}

pub(super) fn revoke(root: &Path, home: &Path) -> Result<()> {
    let _guard = CHANGES.lock().map_err(|_| ComputerError::Storage)?;
    let id = state::home_id(home);
    if let Some(mut record) = state::read(root, &id)? {
        record.administrator = false;
        record.generation = uuid::Uuid::new_v4().to_string();
        state::save(root, &record)?;
    }
    lease::remove(root, &id)?;
    install::refresh_installed(root, home)
}

/// Saving the checkbox never opens UAC. Only GUI entry or an explicit retry can request elevation.
pub(super) fn request_on_entry(root: &Path, home: &Path) -> Result<()> {
    let _guard = CHANGES.lock().map_err(|_| ComputerError::Storage)?;
    let id = state::home_id(home);
    let mut record = state::read(root, &id)?
        .filter(|record| record.enabled)
        .ok_or(ComputerError::Disabled)?;
    record.administrator = true;
    state::save(root, &record)
}

pub(super) fn enable(root: &Path, home: &Path) -> Result<()> {
    let id = state::home_id(home);
    if !PENDING
        .lock()
        .map_err(|_| ComputerError::Storage)?
        .insert(id.clone())
    {
        return Err(ComputerError::Administrator);
    }
    let _pending = Pending(id.clone());
    ATTEMPTED
        .lock()
        .map_err(|_| ComputerError::Storage)?
        .insert(id.clone());
    let generation = {
        let _guard = CHANGES.lock().map_err(|_| ComputerError::Storage)?;
        let record = state::read(root, &id)?
            .filter(|record| record.enabled && record.administrator)
            .ok_or(ComputerError::Disabled)?;
        if status(root, home)?.active {
            return Ok(());
        }
        record.generation
    };
    // UAC can wait for the user. Never hold the installation lock across that wait.
    let request = Bootstrap {
        home_id: id,
        generation,
        #[cfg(debug_assertions)]
        root: root.to_owned(),
    };
    tauri::async_runtime::block_on(authorize(root, home, request))
}

async fn authorize(root: &Path, home: &Path, request: Bootstrap) -> Result<()> {
    let channel = uuid::Uuid::new_v4();
    let bootstrap = pipe::server(channel, true)?;
    let owner = std::process::id();
    let process = native::elevate(&format!("{HELPER}{channel} {owner}"))?;
    tokio::time::timeout(pipe::CONNECT_TIMEOUT, bootstrap.connect())
        .await
        .map_err(|_| ComputerError::Administrator)?
        .map_err(|_| ComputerError::Administrator)?;
    if pipe::client(&bootstrap)? != native::pid(&process) {
        return Err(ComputerError::Administrator);
    }
    let mut bootstrap = bootstrap;
    pipe::write(&mut bootstrap, &request).await?;
    let lease: lease::Lease = pipe::read(&mut bootstrap).await?;
    if lease.owner != owner
        || lease.broker != native::pid(&process)
        || lease.generation != request.generation
        || !process.elevated()?
    {
        return Err(ComputerError::Administrator);
    }
    let _guard = CHANGES.lock().map_err(|_| ComputerError::Storage)?;
    let record = state::read(root, &request.home_id)?.ok_or(ComputerError::Disabled)?;
    if !record.enabled || !record.administrator || record.generation != request.generation {
        return Err(ComputerError::Disabled);
    }
    lease::save(root, &request.home_id, &lease)?;
    install::refresh_installed(root, home)?;
    drop(_guard);
    if let Err(error) = watch::start(process, root, home, &lease) {
        lease::remove(root, &request.home_id)?;
        return Err(error);
    }
    Ok(())
}

/// A declined prompt is remembered in memory, so navigation/reconnect cannot prompt again.
pub(crate) fn prepare_gui(home: &Path) -> Result<()> {
    let root = super::root()?;
    prepare_with(&root, home, &ATTEMPTED, || enable(&root, home))
}

fn prepare_with(
    root: &Path,
    home: &Path,
    attempted: &Mutex<HashSet<String>>,
    authorize: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let id = state::home_id(home);
    if !state::read(root, &id)?.is_some_and(|record| record.enabled && record.administrator) {
        return Ok(());
    }
    if !attempted
        .lock()
        .map_err(|_| ComputerError::Storage)?
        .insert(id)
    {
        return Ok(());
    }
    authorize()
}

pub(super) fn run_helper() -> Option<Result<()>> {
    let argument = std::env::args().nth(1)?;
    #[cfg(debug_assertions)]
    if let Some(result) = probe::run(&argument) {
        return Some(result);
    }
    let channel = argument.strip_prefix(HELPER)?;
    Some((|| {
        let channel = uuid::Uuid::parse_str(channel).map_err(|_| ComputerError::Administrator)?;
        let owner = std::env::args()
            .nth(2)
            .and_then(|pid| pid.parse::<u32>().ok())
            .ok_or(ComputerError::Administrator)?;
        tauri::async_runtime::block_on(broker::run(channel, owner))
    })())
}

pub(super) fn connect(root: &Path, id: &str) -> Result<bool> {
    let Some(lease) = lease::active(root, id) else {
        return Ok(false);
    };
    tauri::async_runtime::block_on(broker::forward(root, id, lease))?;
    Ok(true)
}

#[cfg(test)]
mod tests;
