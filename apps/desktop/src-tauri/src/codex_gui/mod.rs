mod access;
pub(crate) mod account_selection;
pub(crate) mod attachment_preview;
#[cfg(test)]
mod attachment_tests;
mod attachment_uploads;
pub(crate) mod auto_switch_policy;
pub(crate) mod auto_switch_settings;
mod client;
pub(crate) mod clipboard;
mod clipboard_dingtalk;
pub(crate) mod clipboard_images;
mod clipboard_paths;
mod computer_use_setup;
mod connection;
pub(crate) mod context_settings;
mod conversation_context;
pub(crate) mod deletion;
mod downloads;
mod error;
pub(crate) mod file_actions;
pub(crate) mod file_preview;
pub(crate) mod file_stream;
#[cfg(test)]
mod fork_tests;
pub(crate) mod git;
mod goals;
mod home;
mod icons;
mod identity;
pub(crate) mod image_actions;
mod image_download;
mod image_preview;
mod image_thumbnail;
mod images;
mod mcp_approval;
mod message_edit;
pub(crate) mod model_settings;
pub(crate) mod notification_navigation;
mod notifications;
mod platform;
pub(crate) mod plugin_client;
mod project_directories;
mod project_files;
mod prompt;
mod protocol;
pub(crate) mod push_notifications;
mod push_outbox;
mod push_writer;
pub(crate) mod queue_store;
pub(crate) mod releases;
pub(crate) mod scheduled_tasks;
#[cfg(test)]
mod tests;
mod text_preview;
mod title_generation;
mod title_read;
mod title_worker;
#[cfg(windows)]
mod unattended_setup;
pub(crate) mod undo;
pub(crate) mod upload_policy;
pub(crate) mod usage;
pub(crate) mod web;
mod workspaces;

use std::{
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

use client::Client;
use connection::connected;
use error::{GuiError, Result};
use protocol::{ApprovalReply, GuiEvent, GuiRequest, GuiResponse};

#[derive(Default)]
pub(crate) struct GuiState {
    pub(crate) proxy: crate::local_proxy::gui_runtime::GuiProxyRuntime,
    pub(crate) upload_policy: Arc<upload_policy::UploadPolicyStore>,
    client: Mutex<Option<Arc<Client>>>,
    activity: Arc<tokio::sync::RwLock<()>>,
    videos: Arc<file_stream::FileStreams>,
    downloads: DownloadStreams,
}

struct DownloadStreams(Arc<file_stream::FileStreams>);
impl Default for DownloadStreams {
    fn default() -> Self {
        Self(Arc::new(file_stream::FileStreams::downloads()))
    }
}

async fn prepare_paths(app: AppHandle) -> Result<(PathBuf, PathBuf)> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok((home::prepare(&app)?, workspaces::prepare_root(&app)?))
    })
    .await
    .map_err(|_| GuiError::Startup)?
}

#[tauri::command]
pub(crate) async fn codex_gui_connect(
    app: AppHandle,
    state: State<'_, GuiState>,
    reuse_existing: Option<bool>,
) -> std::result::Result<Vec<GuiEvent>, String> {
    connect(app, &state, reuse_existing.unwrap_or(false), true)
        .await
        .map_err(|error| error.to_string())
}

/// Browser connections do not opt the host into desktop control installation.
pub(crate) async fn connect_web(
    app: AppHandle,
    state: State<'_, GuiState>,
    reuse_existing: Option<bool>,
) -> std::result::Result<Vec<GuiEvent>, String> {
    connect(app, &state, reuse_existing.unwrap_or(false), false)
        .await
        .map_err(|error| error.to_string())
}

async fn connect(
    app: AppHandle,
    state: &GuiState,
    reuse_existing: bool,
    setup_computer_use: bool,
) -> Result<Vec<GuiEvent>> {
    let _activity = state.activity.read().await;
    let mut current = state.client.lock().await;
    if let Some(client) = current.as_ref() {
        // A phone reconnect or transport switch must preserve idle, already loaded threads.
        if client.alive.load(Ordering::Acquire) && (reuse_existing || client.is_running().await) {
            return Ok(client.pending_approvals().await);
        }
        client.stop().await;
    }
    let (home, projectless_root) = prepare_paths(app.clone()).await?;
    let release_app = app.clone();
    let binary = tauri::async_runtime::spawn_blocking(move || releases::executable(&release_app))
        .await
        .map_err(|_| GuiError::Executable)??;
    if setup_computer_use {
        computer_use_setup::prepare(app.clone(), home.clone()).await;
    }
    *current = Some(Client::start(app, binary, home, projectless_root).await?);
    Ok(Vec::new())
}

#[tauri::command]
pub(crate) async fn codex_gui_request(
    state: State<'_, GuiState>,
    request: GuiRequest,
) -> std::result::Result<GuiResponse, String> {
    execute_request(&state, request)
        .await
        .map_err(|error| error.to_string())
}

/// Share request validation and typed failures with background GUI operations.
async fn execute_request(state: &GuiState, request: GuiRequest) -> Result<GuiResponse> {
    let client = connected(state).await?;
    match request {
        GuiRequest::DownloadBrowse(options) => return downloads::browse(&client, options).await,
        GuiRequest::DownloadOpen(options) => {
            return downloads::open(&client, Arc::clone(&state.downloads.0), options).await
        }
        GuiRequest::GenerateTitle(options) => return client.generate_title(options).await,
        GuiRequest::FileOpen(options) => {
            return Arc::clone(&state.downloads.0).open(&client, options).await
        }
        GuiRequest::FileRead(options) => return Arc::clone(&state.downloads.0).read(options).await,
        GuiRequest::FileManifest(options) => {
            return Arc::clone(&state.downloads.0).manifest(options).await
        }
        GuiRequest::FileClose(options) => {
            return Arc::clone(&state.downloads.0).close(options).await
        }
        GuiRequest::VideoOpen(options) => {
            return Arc::clone(&state.videos).open(&client, options).await
        }
        GuiRequest::VideoRead(options) => return Arc::clone(&state.videos).read(options).await,
        GuiRequest::VideoClose(options) => return Arc::clone(&state.videos).close(options).await,
        _ => {}
    }
    if let GuiRequest::TextPreview {
        thread_id,
        path,
        max_bytes,
    } = request
    {
        return text_preview::preview(&client, thread_id, path, max_bytes).await;
    }
    if let GuiRequest::ProjectFiles(options) = request {
        return project_files::list(&client, options).await;
    }
    if let GuiRequest::ProjectDirectories { directory } = request {
        return project_directories::list(directory).await;
    }
    if let GuiRequest::EditMessage(edit) = request {
        return message_edit::submit(&client, edit).await;
    }
    if let GuiRequest::ImagePreview {
        thread_id,
        source,
        variant,
        max_bytes,
    } = request
    {
        return image_preview::preview(
            &client,
            thread_id,
            source,
            image_preview::PreviewOptions { variant, max_bytes },
        )
        .await;
    }
    let projectless_root = client.projectless_root.clone();
    let response_root = projectless_root.clone();
    let upload_policy = Arc::clone(&state.upload_policy);
    let (method, params) = tauri::async_runtime::spawn_blocking(move || {
        let mut request = request;
        workspaces::prepare_request_with_upload_policy(
            &mut request,
            &projectless_root,
            upload_policy
                .snapshot()
                .map_err(|_| GuiError::InvalidRequest)?,
        )?;
        request.into_rpc()
    })
    .await
    .map_err(|_| GuiError::InvalidRequest)??;
    let mut data = icons::resolve(method, client.request(method, params).await?).await?;
    workspaces::hide_project_paths(&mut data, &response_root);
    Ok(GuiResponse { data })
}

#[tauri::command]
pub(crate) async fn codex_gui_respond(
    state: State<'_, GuiState>,
    reply: ApprovalReply,
) -> std::result::Result<(), String> {
    async { connected(&state).await?.respond(reply).await }
        .await
        .map_err(|error| error.to_string())
}

pub(crate) fn shutdown(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(client) = app.state::<GuiState>().client.lock().await.take() {
            client.stop().await;
        }
        if tauri::async_runtime::spawn_blocking(move || {
            crate::local_proxy::gui_runtime::shutdown(&app)
        })
        .await
        .is_err()
        {
            eprintln!("Codex GUI connection cleanup failed");
        }
    });
}
