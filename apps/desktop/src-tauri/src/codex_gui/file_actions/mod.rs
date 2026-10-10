//! Desktop-only file actions. Paths come from an explicit click; never expose these commands to web clients.
mod apps;
#[cfg(windows)]
mod icons_windows;
mod paths;
mod save;
#[cfg(test)]
mod tests;
#[cfg(not(windows))]
mod unix;
#[cfg(windows)]
mod windows;

use super::{connected, protocol::thread_params, GuiState};
use serde::{Deserialize, Serialize};
use std::{fs::File, io::Read, path::PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, thiserror::Error)]
pub(super) enum FileError {
    #[error("文件路径无效，请重新选择文件。")]
    Path,
    #[error("找不到这个文件，请确认文件仍然存在。")]
    Missing,
    #[error("暂时无法读取对话的文件夹，请重新连接后再试。")]
    Workspace,
    #[error("未找到这个应用，请确认已安装后重试。")]
    Application,
    #[error("文件未能打开，请尝试其他应用。")]
    Open,
    #[error("无法复制此文件，请选择不超过 2 MB 的纯文本文件。")]
    Text,
    #[error("文件未能复制，请稍后重试。")]
    Copy,
    #[error("文件未能保存，请检查保存位置后重试。")]
    Save,
}
type Result<T> = std::result::Result<T, FileError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FileTarget {
    path: String,
    thread_id: Option<String>,
    pub(super) line: Option<u32>,
    pub(super) column: Option<u32>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum FileAction {
    Open { application: apps::ApplicationId },
    Reveal {},
    CopyFile {},
    CopyPath {},
    CopyContents {},
    SaveAs {},
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FileRequest {
    target: FileTarget,
    action: FileAction,
}

#[derive(Serialize)]
pub(crate) struct FileResponse {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    saved: bool,
}

#[tauri::command]
pub(crate) async fn codex_gui_file_applications(
) -> std::result::Result<Vec<apps::Application>, String> {
    tauri::async_runtime::spawn_blocking(apps::available)
        .await
        .map_err(|_| FileError::Application.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_file_action(
    app: AppHandle,
    state: State<'_, GuiState>,
    request: FileRequest,
) -> std::result::Result<FileResponse, String> {
    async {
        let source = paths::source(&request.target)?;
        let workspace = workspace(&state, &request.target, &source).await?;
        tauri::async_runtime::spawn_blocking(move || perform(&app, request, source, workspace))
            .await
            .map_err(|_| FileError::Open)?
    }
    .await
    .map_err(|error: FileError| error.to_string())
}

/// Resolve an explicitly selected desktop file using the conversation's real workspace.
pub(super) async fn resolve_target(state: &GuiState, target: &FileTarget) -> Result<PathBuf> {
    let source = paths::source(target)?;
    let workspace = workspace(state, target, &source).await?;
    tauri::async_runtime::spawn_blocking(move || paths::resolve(&source, &workspace, false))
        .await
        .map_err(|_| FileError::Path)?
}

async fn workspace(
    state: &GuiState,
    target: &FileTarget,
    source: &std::path::Path,
) -> Result<PathBuf> {
    if source.is_absolute() {
        return Ok(PathBuf::new());
    }
    let thread_id = target.thread_id.as_ref().ok_or(FileError::Workspace)?;
    let params = thread_params(thread_id.clone()).map_err(|_| FileError::Workspace)?;
    let client = connected(state).await.map_err(|_| FileError::Workspace)?;
    // Use the real server workspace, including scratch folders hidden from presentation.
    let response = client
        .request("thread/read", params)
        .await
        .map_err(|_| FileError::Workspace)?;
    response["thread"]["cwd"]
        .as_str()
        .map(PathBuf::from)
        .ok_or(FileError::Workspace)
}

fn perform(
    app: &AppHandle,
    request: FileRequest,
    source: PathBuf,
    workspace: PathBuf,
) -> Result<FileResponse> {
    let path = paths::resolve(
        &source,
        &workspace,
        matches!(request.action, FileAction::CopyPath {}),
    )?;
    let mut response = FileResponse {
        path: super::platform::execution_path(&path),
        text: None,
        saved: false,
    };
    match request.action {
        FileAction::Open { application } => apps::open(application, &path, &request.target)?,
        FileAction::Reveal {} => {
            tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|_| FileError::Open)?
        }
        FileAction::CopyFile {} => copy_file(&path)?,
        FileAction::CopyPath {} => {}
        FileAction::CopyContents {} => response.text = Some(read_text(&path)?),
        FileAction::SaveAs {} => response.saved = save_as(app, &path)?,
    }
    Ok(response)
}

fn copy_file(path: &std::path::Path) -> Result<()> {
    // Publish a native file reference (CF_HDROP on Windows) without reading the contents,
    // so installers and other large binary files are copyable too.
    arboard::Clipboard::new()
        .map_err(|_| FileError::Copy)?
        .set()
        .file_list(&[path])
        .map_err(|_| FileError::Copy)
}

fn read_text(path: &std::path::Path) -> Result<String> {
    const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
    let file = File::open(path).map_err(|_| FileError::Text)?;
    let metadata = file.metadata().map_err(|_| FileError::Text)?;
    if !metadata.is_file() || metadata.len() > MAX_TEXT_BYTES {
        return Err(FileError::Text);
    }
    let mut text = String::new();
    file.take(MAX_TEXT_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|_| FileError::Text)?;
    if text.len() as u64 > MAX_TEXT_BYTES || text.contains('\0') {
        return Err(FileError::Text);
    }
    Ok(text)
}

fn save_as(app: &AppHandle, path: &std::path::Path) -> Result<bool> {
    if !path.is_file() {
        return Err(FileError::Save);
    }
    let name = path.file_name().ok_or(FileError::Path)?.to_string_lossy();
    // Only the native save dialog supplies a destination; IPC cannot request arbitrary writes.
    let Some(destination) = app
        .dialog()
        .file()
        .set_title("文件另存为")
        .set_file_name(name)
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let destination = destination.into_path().map_err(|_| FileError::Save)?;
    if !destination.is_absolute() {
        return Err(FileError::Save);
    }
    if destination.canonicalize().is_ok_and(|value| value == path) {
        return Ok(false);
    }
    save::copy(path, &destination)?;
    Ok(true)
}
