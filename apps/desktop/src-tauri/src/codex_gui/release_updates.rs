use super::{
    errors, http_client, prepare_package, release, root, store, CliStatus, GuiError, Installed,
    ReleaseInfo, Result,
};
use std::{
    path::Path,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};

#[path = "release_auto_update.rs"]
mod automatic;

#[derive(Default)]
pub(crate) struct CliUpdateState {
    startup: OnceLock<()>,
    scheduler: OnceLock<()>,
    pub(super) metadata: Mutex<()>,
    // Serialize package writes without blocking other callers from discovering newer releases.
    download: tokio::sync::Mutex<()>,
}

/// Every reader shares this barrier, including plugins and scheduled conversations.
/// Only cached packages from a previous run can be activated here.
pub(super) fn initialize(app: &AppHandle) {
    app.state::<CliUpdateState>().startup.get_or_init(|| {
        if let Err(error) = root(app).and_then(|root| store::activate(&root)) {
            eprintln!("Codex GUI cached update could not be applied: {error}");
        }
    });
}

pub(crate) fn start(app: &AppHandle) {
    app.state::<CliUpdateState>()
        .scheduler
        .get_or_init(|| automatic::start(app.clone()));
}

pub(super) fn status(app: &AppHandle) -> Result<CliStatus> {
    initialize(app);
    let state = app.state::<CliUpdateState>();
    let _metadata = state
        .metadata
        .lock()
        .map_err(|error| errors::failure("lock installation records", &error, GuiError::Install))?;
    store::status(&root(app)?)
}

fn check(app: &AppHandle) -> Result<ReleaseInfo> {
    initialize(app);
    let (version, asset) = release(&http_client()?, None)?;
    let state = app.state::<CliUpdateState>();
    let _guard = state
        .metadata
        .lock()
        .map_err(|error| errors::failure("lock installation records", &error, GuiError::Install))?;
    store::remember(
        &root(app)?,
        ReleaseInfo {
            version,
            size: asset.size,
            ready: false,
        },
    )
}

#[tauri::command]
pub(crate) async fn codex_gui_cli_check(
    app: AppHandle,
) -> std::result::Result<ReleaseInfo, String> {
    tauri::async_runtime::spawn_blocking(move || check(&app))
        .await
        .map_err(|_| GuiError::Release.to_string())?
        .map_err(|error| error.to_string())
}

fn prepare(app: &AppHandle, activate: bool) -> Result<ReleaseInfo> {
    initialize(app);
    let root = root(app)?;
    let state = app.state::<CliUpdateState>();
    prepare_latest(&root, &state.metadata, activate, |candidate| {
        let (_, asset) = release(&http_client()?, Some(&candidate.version))?;
        prepare_package(app, &candidate.version, &asset, !activate)
    })
}

fn prepare_latest(
    root: &Path,
    metadata: &Mutex<()>,
    activate: bool,
    mut download: impl FnMut(&ReleaseInfo) -> Result<()>,
) -> Result<ReleaseInfo> {
    loop {
        let candidate = {
            let _guard = metadata.lock().map_err(|error| {
                errors::failure("lock installation records", &error, GuiError::Install)
            })?;
            store::pending(root)?.ok_or(GuiError::Release)?
        };
        let outcome = if candidate.ready {
            Ok(())
        } else {
            download(&candidate)
        };
        let _guard = metadata.lock().map_err(|error| {
            errors::failure("lock installation records", &error, GuiError::Install)
        })?;
        let current = store::pending(root)?.ok_or(GuiError::Release)?;
        if current.version != candidate.version {
            // A newer check won while this download was running. Never publish/activate the stale result.
            continue;
        }
        outcome?;
        if !current.ready {
            return Err(GuiError::Install);
        }
        if activate {
            store::activate(root)?;
        }
        return Ok(current);
    }
}

#[cfg(test)]
#[path = "release_updates_tests.rs"]
mod tests;

async fn prepare_serialized(app: AppHandle, activate: bool) -> Result<ReleaseInfo> {
    let state = app.state::<CliUpdateState>();
    let _guard = state.download.lock().await;
    let worker_app = app.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || prepare(&worker_app, activate))
        .await
        .map_err(|error| errors::failure("run installation worker", &error, GuiError::Install))??;
    if !activate {
        automatic::apply_ready(&app).await?;
    }
    Ok(prepared)
}

#[tauri::command]
pub(crate) async fn codex_gui_cli_prepare(
    app: AppHandle,
) -> std::result::Result<ReleaseInfo, String> {
    prepare_serialized(app, false)
        .await
        .map_err(|error| error.to_string())
}

pub(super) async fn install(app: AppHandle) -> Result<Installed> {
    let check_app = app.clone();
    let candidate = tauri::async_runtime::spawn_blocking(move || match check(&check_app) {
        Ok(candidate) => Ok(candidate),
        Err(error) => {
            let state = check_app.state::<CliUpdateState>();
            let _guard = state.metadata.lock().map_err(|error| {
                errors::failure("lock installation records", &error, GuiError::Install)
            })?;
            store::pending(&root(&check_app)?)?
                .filter(|candidate| candidate.ready)
                .ok_or(error)
        }
    })
    .await
    .map_err(|error| errors::failure("run installation worker", &error, GuiError::Install))??;
    if candidate.size > 0 {
        prepare_serialized(app.clone(), true).await?;
    }
    tauri::async_runtime::spawn_blocking(move || store::installed(&root(&app)?))
        .await
        .map_err(|error| errors::failure("run installation worker", &error, GuiError::Install))?
}

/// Imported packages share idle activation with automatic updates, without waiting for network downloads.
pub(super) async fn apply_import(app: &AppHandle) -> Result<CliStatus> {
    automatic::apply_ready(app).await?;
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || status(&app))
        .await
        .map_err(|error| errors::failure("run installation worker", &error, GuiError::Install))?
}
