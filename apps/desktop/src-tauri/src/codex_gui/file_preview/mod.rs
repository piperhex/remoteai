//! Sidebar file previews with scoped, explicitly released streaming sessions.
mod content;
pub(crate) mod hosted;
mod lifecycle;
#[cfg(all(test, windows))]
mod native_smoke;
mod navigation;
mod range;
mod server;
pub(crate) mod website;

use super::{
    file_actions::{self, FileTarget},
    GuiState,
};
use content::PreviewData;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{Manager, Webview};
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
enum PreviewError {
    #[error("暂时无法读取此文件，请从文件菜单选择其他打开方式。")]
    Read,
    #[error("预览未能打开，请稍后重试。")]
    Open,
}
impl From<std::io::Error> for PreviewError {
    fn from(_: std::io::Error) -> Self {
        Self::Read
    }
}
type Result<T> = std::result::Result<T, PreviewError>;

struct PreviewSession {
    owner: String,
    generation: u64,
    _server: server::PreviewServer,
}

#[derive(Default)]
pub(crate) struct PreviewSessions {
    hosted: Mutex<hosted::HostedSessions>,
    generation: AtomicU64,
    sessions: Mutex<HashMap<String, PreviewSession>>,
}

pub(crate) use lifecycle::{handle_page_load, handle_window_event};

/// Unsupported files return None so the clicked link can show its original menu.
#[tauri::command]
pub(crate) async fn codex_gui_open_file_preview(
    webview: Webview,
    target: FileTarget,
) -> std::result::Result<Option<PreviewData>, String> {
    website::validate_owner(&webview).map_err(|error| error.to_string())?;
    let generation = webview
        .state::<PreviewSessions>()
        .generation
        .load(Ordering::Acquire);
    let path = file_actions::resolve_target(&webview.state::<GuiState>(), &target)
        .await
        .map_err(|error| error.to_string())?;
    let session = tauri::async_runtime::spawn_blocking(move || load_session(&path, &target))
        .await
        .map_err(|_| PreviewError::Open.to_string())?
        .map_err(|error| error.to_string())?;
    let Some((data, server)) = session else {
        return Ok(None);
    };
    let state = webview.state::<PreviewSessions>();
    let mut sessions = state.sessions.lock().await;
    if state.generation.load(Ordering::Acquire) != generation {
        return Err(PreviewError::Open.to_string());
    }
    sessions.insert(
        data.session_id.clone(),
        PreviewSession {
            owner: webview.label().to_owned(),
            generation,
            _server: server,
        },
    );
    Ok(Some(data))
}

fn load_session(
    path: &std::path::Path,
    target: &FileTarget,
) -> Result<Option<(PreviewData, server::PreviewServer)>> {
    let Some(mut data) = content::load(path)? else {
        return Ok(None);
    };
    let server = server::PreviewServer::start(path)?;
    data.url = server.url.clone();
    data.line = target.line;
    data.column = target.column;
    data.session_id = uuid::Uuid::new_v4().to_string();
    Ok(Some((data, server)))
}

#[tauri::command]
pub(crate) async fn codex_gui_close_file_preview(
    webview: Webview,
    session_id: String,
) -> std::result::Result<(), String> {
    let state = webview.state::<PreviewSessions>();
    let mut sessions = state.sessions.lock().await;
    if sessions
        .get(&session_id)
        .is_some_and(|session| session.owner == webview.label())
    {
        sessions.remove(&session_id);
    }
    Ok(())
}

/// Authorize only the exact loopback listener created by the authenticated preview viewer.
#[tauri::command]
pub(crate) async fn codex_gui_file_preview_host(
    webview: Webview,
    session_id: String,
    host: String,
) -> std::result::Result<(), String> {
    website::validate_owner(&webview).map_err(|error| error.to_string())?;
    let state = webview.state::<PreviewSessions>();
    let sessions = state.sessions.lock().await;
    let session = sessions
        .get(&session_id)
        .filter(|session| session.owner == webview.label())
        .ok_or_else(|| PreviewError::Open.to_string())?;
    session
        ._server
        .forward_host(host)
        .map_err(|error| error.to_string())
}
