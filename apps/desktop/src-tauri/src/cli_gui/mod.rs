//! Isolated multi-CLI worker. All process and filesystem work stays off the UI thread.
mod process;
mod protocol;
#[cfg(windows)]
mod windows_job;

use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

pub(crate) use protocol::Request;
type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub(super) enum Error {
    #[error("client.cliGui.nodeRequired")]
    Startup,
    #[error("client.cliGui.connectionFailed")]
    Connection,
    #[error("client.cliGui.invalidRequest")]
    Invalid,
    #[error("{0}")]
    Worker(String),
}

#[derive(Default)]
pub(crate) struct CliGuiState(Mutex<Option<Arc<process::Client>>>);

#[tauri::command]
pub(crate) async fn cli_gui_request(
    app: AppHandle,
    state: State<'_, CliGuiState>,
    request: Request,
) -> std::result::Result<serde_json::Value, String> {
    execute(app, &state, request)
        .await
        .map_err(|error| error.to_string())
}

async fn execute(
    app: AppHandle,
    state: &CliGuiState,
    request: Request,
) -> Result<serde_json::Value> {
    let request = tauri::async_runtime::spawn_blocking(move || request.validate())
        .await
        .map_err(|_| Error::Invalid)??;
    let client = {
        let mut current = state.0.lock().await;
        if !current.as_ref().is_some_and(|client| client.alive()) {
            *current = Some(process::Client::start(app).await?);
        }
        Arc::clone(current.as_ref().ok_or(Error::Connection)?)
    };
    client.request(request).await
}
