//! One application-owned worker checks and stages CLI updates, independent of GUI visibility.
use super::super::errors;
use super::{check, initialize, prepare, root, store, CliStatus, CliUpdateState, GuiError, Result};
use crate::codex_gui::{client::Client, protocol::GuiEvent, releases::Executable, GuiState};
use std::{sync::atomic::Ordering, sync::Arc, time::Duration};
use tauri::{AppHandle, Manager};

const CHECK_INTERVAL: Duration = Duration::from_secs(30 * 60);
const IDLE_CHECK_TIMEOUT: Duration = Duration::from_secs(2);

pub(super) fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let worker_app = app.clone();
        if tauri::async_runtime::spawn_blocking(move || initialize(&worker_app))
            .await
            .is_err()
        {
            eprintln!("Codex GUI update initialization failed");
            return;
        }
        let mut timer = tokio::time::interval(CHECK_INTERVAL);
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            if let Err(error) = cycle(&app).await {
                eprintln!("Codex GUI automatic update deferred: {error}");
            }
        }
    });
}

async fn snapshot(app: &AppHandle) -> Result<CliStatus> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || super::status(&app))
        .await
        .map_err(|error| errors::failure("run installation worker", &error, GuiError::Install))?
}

async fn publish(app: &AppHandle) -> Result<()> {
    crate::codex_gui::web::publish(app, "codex-gui-cli-state", snapshot(app).await?);
    Ok(())
}

async fn cycle(app: &AppHandle) -> Result<()> {
    let state = app.state::<CliUpdateState>();
    let Ok(_download) = state.download.try_lock() else {
        return Ok(());
    };
    // First installation stays an explicit user action.
    if snapshot(app).await?.version.is_none() {
        return Ok(());
    }
    let worker_app = app.clone();
    let checked = tauri::async_runtime::spawn_blocking(move || check(&worker_app))
        .await
        .map_err(|_| GuiError::Release)?;
    publish(app).await?;
    if checked
        .as_ref()
        .is_ok_and(|candidate| candidate.size > 0 && !candidate.ready)
    {
        let worker_app = app.clone();
        tauri::async_runtime::spawn_blocking(move || prepare(&worker_app, false))
            .await
            .map_err(|error| {
                errors::failure("run installation worker", &error, GuiError::Install)
            })??;
    }
    apply_ready(app).await?;
    checked.map(|_| ())
}

/// Check fresh state after every background download, including downloads requested by the GUI.
/// A failed online check still allows an already cached update to be applied while idle.
pub(super) async fn apply_ready(app: &AppHandle) -> Result<()> {
    let current = snapshot(app).await?;
    let outcome = match eligible_version(&current) {
        Some(version) => activate_idle(app, version).await,
        None => Ok(()),
    };
    publish(app).await?;
    outcome
}

fn eligible_version(current: &CliStatus) -> Option<&str> {
    let installed = current.version.as_deref()?;
    current
        .release
        .as_ref()
        .filter(|candidate| candidate.ready && installed != candidate.version)
        .map(|candidate| candidate.version.as_str())
}

async fn activate_idle(app: &AppHandle, expected: &str) -> Result<()> {
    let state = app.state::<GuiState>();
    let Ok(_activity) = state.activity.try_write() else {
        return Ok(());
    };
    let Ok(mut current) = state.client.try_lock() else {
        return Ok(());
    };
    if let Some(client) = current
        .as_ref()
        .filter(|client| client.alive.load(Ordering::Acquire))
    {
        match tokio::time::timeout(IDLE_CHECK_TIMEOUT, client.ready_for_update()).await {
            Ok(Ok(true)) => {}
            _ => return Ok(()), // Unknown or slow conversation state is never treated as idle.
        }
    }
    let replacement = replacement(app, current.as_ref(), expected).await?;
    if replacement
        .as_ref()
        .is_some_and(|client| !client.alive.load(Ordering::Acquire))
    {
        return Err(GuiError::Startup);
    }
    let activated = activate_pointer(app, expected).await;
    if !matches!(activated, Ok(true)) {
        if let Some(client) = replacement {
            client.stop().await;
        }
        return activated.map(|_| ());
    }
    if let Some(client) = current.take() {
        client.stop().await;
    }
    if let Some(client) = &replacement {
        client.activate();
    }
    *current = replacement;
    if current.is_some() {
        publish_connection(app);
    }
    Ok(())
}

async fn activate_pointer(app: &AppHandle, expected: &str) -> Result<bool> {
    let app = app.clone();
    let expected = expected.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<CliUpdateState>();
        let _metadata = state.metadata.lock().map_err(|error| {
            errors::failure("lock installation records", &error, GuiError::Install)
        })?;
        store::activate_expected(&root(&app)?, &expected).map(|installed| installed.is_some())
    })
    .await
    .map_err(|error| errors::failure("run installation worker", &error, GuiError::Install))?
}

fn publish_connection(app: &AppHandle) {
    crate::codex_gui::web::publish(
        app,
        "codex-gui-event",
        GuiEvent {
            method: "connection/updated".into(),
            params: serde_json::json!({}),
            id: None,
        },
    );
}

async fn replacement(
    app: &AppHandle,
    current: Option<&Arc<Client>>,
    version: &str,
) -> Result<Option<Arc<Client>>> {
    let Some(current) = current else {
        return Ok(None);
    };
    let worker_app = app.clone();
    let version = version.to_owned();
    let binary = tauri::async_runtime::spawn_blocking(move || {
        let root = root(&worker_app)?;
        if !store::activation_candidate(&root, &version)? {
            return Ok(None);
        }
        Ok(Some(Executable {
            path: root.join(&version).join(super::super::entrypoint()),
            version,
        }))
    })
    .await
    .map_err(|error| errors::failure("run installation worker", &error, GuiError::Install))??;
    let Some(binary) = binary else {
        return Ok(None);
    };
    Client::start_staged(
        app.clone(),
        binary,
        current.home.clone(),
        current.projectless_root.clone(),
    )
    .await
    .map(Some)
}

#[cfg(test)]
#[path = "release_auto_update_tests.rs"]
mod tests;
