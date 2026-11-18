//! Apply a requested home change before any Agent Hub worker can open a database or rollout.
use crate::models::CodexHomeEntry;
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, Runtime};

mod copy;
#[cfg(test)]
mod tests;

const SETTINGS: &str = "agent-hub-home.json";
const INVALID: &str = "AGENT_HUB_HOME_INVALID";
const FAILED: &str = "AGENT_HUB_HOME_FAILED";
const HISTORY_PREFIX: &str = "previous:";
static CHANGE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HomeMode {
    Copy,
    Fresh,
    Restore,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct HomeChange {
    path: PathBuf,
    mode: HomeMode,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct HomeLocations {
    current: PathBuf,
    history: Vec<CodexHomeEntry>,
    pending: Option<HomeChange>,
    failed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    transaction: Option<uuid::Uuid>,
}

#[derive(Serialize)]
pub(crate) struct HomeSnapshot {
    current: PathBuf,
    history: Vec<CodexHomeEntry>,
    pending: Option<HomeChange>,
    failed: bool,
}

impl From<HomeLocations> for HomeSnapshot {
    fn from(state: HomeLocations) -> Self {
        Self {
            current: state.current,
            history: state.history,
            pending: state.pending,
            failed: state.failed,
        }
    }
}

pub(super) struct RuntimeLocations {
    pub(super) current: PathBuf,
    pub(super) history: Vec<CodexHomeEntry>,
}

fn read(root: &Path) -> Result<HomeLocations, String> {
    match fs::read(root.join(SETTINGS)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| FAILED.to_owned()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(HomeLocations {
            current: root.join(".codex"),
            history: Vec::new(),
            pending: None,
            failed: false,
            transaction: None,
        }),
        Err(_) => Err(FAILED.into()),
    }
}

fn save(root: &Path, state: &HomeLocations) -> Result<(), String> {
    let json = serde_json::to_value(state).map_err(|_| FAILED.to_owned())?;
    crate::storage::write_json_atomic(&root.join(SETTINGS), &json).map_err(|_| FAILED.to_owned())
}

fn root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|_| FAILED.into())
}

pub(super) fn initialize<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let root = root(app)?;
    let mut state = read(&root)?;
    if let Some(change) = state.pending.take() {
        let settings = crate::storage::read_app_settings(app)?;
        state.failed = apply(&mut state, &change, &settings.codex_homes).is_err();
        state.transaction = None;
        save(&root, &state)?;
    }
    app.manage(RuntimeLocations {
        current: state.current,
        history: state.history,
    });
    Ok(())
}

pub(crate) fn history<R: Runtime>(app: &AppHandle<R>) -> Vec<CodexHomeEntry> {
    app.try_state::<RuntimeLocations>()
        .map(|s| s.history.clone())
        .unwrap_or_default()
}

pub(super) fn is_history_id(id: &str) -> bool {
    id.starts_with(HISTORY_PREFIX)
}

fn normalized(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_owned())
}

fn overlaps(left: &Path, right: &Path) -> bool {
    let left = normalized(left);
    let right = normalized(right);
    left.starts_with(&right) || right.starts_with(left)
}

fn validate(
    state: &HomeLocations,
    change: &HomeChange,
    homes: &[CodexHomeEntry],
) -> Result<(), String> {
    let target = &change.path;
    if !super::is_safe_home_path(target) || !target.is_dir() || overlaps(target, &state.current) {
        return Err(INVALID.into());
    }
    let previous = state
        .history
        .iter()
        .any(|h| super::paths_match(target, Path::new(&h.path)));
    if previous != (change.mode == HomeMode::Restore) {
        return Err(INVALID.into());
    }
    let mut external = homes.iter().filter(|h| h.id != super::GUI_CODEX_HOME_ID);
    if external.any(|h| overlaps(target, Path::new(&h.path)))
        || dirs::home_dir().is_some_and(|home| overlaps(target, &home.join(".codex")))
        || state.history.iter().any(|h| {
            !super::paths_match(target, Path::new(&h.path)) && overlaps(target, Path::new(&h.path))
        })
    {
        return Err(INVALID.into());
    }
    let mut entries = fs::read_dir(target).map_err(|_| INVALID.to_owned())?;
    if !previous && entries.next().is_some() && !copy_completed(state, change) {
        return Err(INVALID.into());
    }
    tempfile::NamedTempFile::new_in(target)
        .and_then(|probe| probe.close())
        .map_err(|_| FAILED.to_owned())
}

fn copy_completed(state: &HomeLocations, change: &HomeChange) -> bool {
    change.mode == HomeMode::Copy
        && state
            .transaction
            .is_some_and(|id| copy::published(&change.path, id))
}

fn apply(
    state: &mut HomeLocations,
    change: &HomeChange,
    homes: &[CodexHomeEntry],
) -> Result<(), String> {
    // A crash after publishing the directory but before saving settings can safely finish on restart.
    validate(state, change, homes)?;
    if change.mode == HomeMode::Copy && !copy_completed(state, change) {
        copy::install(
            &state.current,
            &change.path,
            state.transaction.ok_or(FAILED)?,
        )?;
    }
    state
        .history
        .retain(|h| !super::paths_match(Path::new(&h.path), &change.path));
    state.history.push(CodexHomeEntry {
        id: format!("{HISTORY_PREFIX}{}", uuid::Uuid::new_v4()),
        path: state.current.to_string_lossy().into_owned(),
        enabled: false,
    });
    state.current.clone_from(&change.path);
    Ok(())
}

#[tauri::command]
pub(crate) async fn agent_hub_home<R: Runtime>(app: AppHandle<R>) -> Result<HomeSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || read(&root(&app)?).map(HomeSnapshot::from))
        .await
        .map_err(|_| FAILED.to_owned())?
}

#[tauri::command]
pub(crate) async fn change_agent_hub_home<R: Runtime>(
    app: AppHandle<R>,
    mut change: Option<HomeChange>,
) -> Result<HomeSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHANGE_LOCK.lock().map_err(|_| FAILED.to_owned())?;
        let root = root(&app)?;
        let mut state = read(&root)?;
        if let Some(change) = &mut change {
            if !super::is_safe_home_path(&change.path) {
                return Err(INVALID.into());
            }
            let canonical = change.path.canonicalize().map_err(|_| INVALID.to_owned())?;
            change.path = PathBuf::from(crate::codex_gui::execution_path(&canonical));
            validate(
                &state,
                change,
                &crate::storage::read_app_settings(&app)?.codex_homes,
            )?;
        }
        state.transaction = change.as_ref().map(|_| uuid::Uuid::new_v4());
        state.pending = change;
        state.failed = false;
        save(&root, &state)?;
        Ok(state.into())
    })
    .await
    .map_err(|_| FAILED.to_owned())?
}
