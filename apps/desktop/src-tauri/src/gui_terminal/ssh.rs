//! Thin IPC boundary; network I/O and session ownership live in the shared SSH service.
use csw_ssh_client::{Client, Command, Connect, Endpoint, Event, FileAction, FileReply, Info};
use std::sync::Arc;
use tauri::{ipc::Channel, AppHandle, Manager, Window};

#[tauri::command]
pub(crate) async fn codex_gui_ssh_ensure_x11(
    window: Window,
    options: csw_ssh_client::X11,
) -> Result<(), String> {
    super::authorize(&window).map_err(|error| error.to_string())?;
    csw_ssh_client::ensure_x11(options)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_ssh_probe(
    window: Window,
    endpoint: Endpoint,
) -> Result<String, String> {
    super::authorize(&window).map_err(|error| error.to_string())?;
    csw_ssh_client::probe(endpoint)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_ssh_open(
    app: AppHandle,
    window: Window,
    request: Connect,
    on_event: Channel<Event>,
) -> Result<Info, String> {
    super::authorize(&window).map_err(|error| error.to_string())?;
    app.state::<Arc<Client>>()
        .inner()
        .clone()
        .open(request, Arc::new(move |event| on_event.send(event).is_ok()))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_ssh_command(
    app: AppHandle,
    window: Window,
    request: Command,
) -> Result<(), String> {
    super::authorize(&window).map_err(|error| error.to_string())?;
    app.state::<Arc<Client>>()
        .command(request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_ssh_monitor(
    app: AppHandle,
    window: Window,
    id: String,
) -> Result<csw_ssh_client::ServerSample, String> {
    super::authorize(&window).map_err(|error| error.to_string())?;
    app.state::<Arc<Client>>()
        .monitor(&id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_ssh_files(
    app: AppHandle,
    window: Window,
    id: String,
    request: FileAction,
) -> Result<FileReply, String> {
    super::authorize(&window).map_err(|error| error.to_string())?;
    app.state::<Arc<Client>>()
        .files(&id, request)
        .await
        .map_err(|error| error.to_string())
}
