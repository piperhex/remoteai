//! Undo uses server-owned edit records and prepares every result before touching the workspace.
use super::{git::GitState, protocol, GuiState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};

#[path = "undo_files.rs"]
mod files;
#[cfg(test)]
#[path = "undo_tests.rs"]
mod tests;

const MAX_EDIT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
enum UndoError {
    #[error(transparent)]
    Gui(#[from] super::error::GuiError),
    #[error("无法撤销这次修改，请重新打开对话后重试。")]
    Invalid,
    #[error("请等待当前回复结束后再撤销。")]
    Busy,
    #[error("文件已有其他修改，无法完整撤销。请先审核差异。")]
    Conflict,
    #[error("撤销未完成，请确认文件可写后重试。")]
    Io,
    #[error("撤销需要 Git，请确认已安装 Git。")]
    Git,
    #[error("部分文件未能恢复，请检查项目文件后再继续。")]
    Recovery,
}
type Result<T> = std::result::Result<T, UndoError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UndoRequest {
    thread_id: String,
    turn_id: String,
    #[serde(default)]
    check_only: bool,
    #[serde(default)]
    preview: bool,
    expected_version: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct UndoResponse {
    undone: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<RestorePreview>,
}

#[derive(Serialize)]
struct RestorePreview {
    files: Vec<String>,
    conflict: bool,
    version: String,
}

impl UndoResponse {
    fn done(undone: bool) -> Self {
        Self {
            undone,
            preview: None,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeKind {
    #[serde(rename = "type")]
    kind: String,
    move_path: Option<String>,
}

#[derive(Deserialize)]
struct Change {
    path: String,
    diff: String,
    kind: ChangeKind,
}

fn changes(thread: &Value, turn_id: &str) -> Result<Vec<Change>> {
    let turns = thread["turns"].as_array().ok_or(UndoError::Invalid)?;
    if thread["status"]["type"] == "active"
        || turns.iter().any(|turn| turn["status"] == "inProgress")
    {
        return Err(UndoError::Busy);
    }
    let turn = turns
        .iter()
        .find(|turn| turn["id"] == turn_id)
        .ok_or(UndoError::Invalid)?;
    let mut changes = Vec::new();
    if turn["reviewIncomplete"] == true
        || turn["diff"]
            .as_str()
            .is_some_and(|diff| diff.trim().is_empty())
    {
        return Err(UndoError::Invalid);
    }
    let items = turn["reviewEdits"]
        .as_array()
        .filter(|items| !items.is_empty())
        .or_else(|| turn["items"].as_array());
    for item in items.ok_or(UndoError::Invalid)? {
        if item["type"] != "fileChange" || item["status"] != "completed" {
            continue;
        }
        let edits: Vec<Change> =
            serde_json::from_value(item["changes"].clone()).map_err(|_| UndoError::Invalid)?;
        changes.extend(edits);
    }
    if changes.is_empty()
        || changes
            .iter()
            .map(|change| change.diff.len())
            .sum::<usize>()
            > MAX_EDIT_BYTES
    {
        return Err(UndoError::Invalid);
    }
    Ok(changes)
}

/// Reject traversal, Git metadata, alternate streams, and symlink/junction ancestors.
fn relative_path(root: &Path, value: &str) -> Result<PathBuf> {
    let path = Path::new(value);
    let display_root = super::platform::execution_path(root);
    let relative = if path.is_absolute() {
        path.strip_prefix(root)
            .or_else(|_| path.strip_prefix(&display_root))
            .map_err(|_| UndoError::Invalid)?
    } else {
        path
    };
    if relative.as_os_str().is_empty() {
        return Err(UndoError::Invalid);
    }
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(UndoError::Invalid);
        };
        let name_text = name.to_string_lossy();
        if name_text.to_lowercase().trim_end_matches([' ', '.']) == ".git"
            || name_text.contains(':')
        {
            return Err(UndoError::Invalid);
        }
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => return Err(UndoError::Invalid),
            Ok(_)
                if !current
                    .canonicalize()
                    .map_err(|_| UndoError::Io)?
                    .starts_with(root) =>
            {
                return Err(UndoError::Invalid);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(UndoError::Io),
        }
    }
    Ok(relative.to_owned())
}

fn normalized_changes(root: &Path, changes: Vec<Change>) -> Result<Vec<Change>> {
    changes
        .into_iter()
        .map(|mut change| {
            change.path = relative_path(root, &change.path)?
                .to_string_lossy()
                .replace('\\', "/");
            change.kind.move_path = change
                .kind
                .move_path
                .map(|path| {
                    relative_path(root, &path).map(|path| path.to_string_lossy().replace('\\', "/"))
                })
                .transpose()?;
            Ok(change)
        })
        .collect()
}

fn receipt_path(app: &AppHandle, request: &UndoRequest) -> Result<PathBuf> {
    let key = format!("{}\0{}", request.thread_id, request.turn_id);
    let hash = format!("{:x}", Sha256::digest(key.as_bytes()));
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| UndoError::Io)?
        .join("edit-undo")
        .join(hash))
}

#[cfg(test)]
fn execute(root: &Path, edits: Vec<Change>, receipt: &Path) -> Result<UndoResponse> {
    execute_version(root, edits, receipt, None)
}

fn execute_version(
    root: &Path,
    edits: Vec<Change>,
    receipt: &Path,
    expected: Option<&str>,
) -> Result<UndoResponse> {
    if receipt.join("completed").is_file() {
        return Ok(UndoResponse::done(true));
    }
    let edits = normalized_changes(root, edits)?;
    fs::create_dir_all(receipt).map_err(|_| UndoError::Io)?;
    let staging = receipt.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&staging).map_err(|_| UndoError::Io)?;
    let result = files::prepare_and_apply(root, &staging, &edits, expected);
    // Preserve a failed recovery's backups; successful and untouched staging directories are disposable.
    if !matches!(result, Err(UndoError::Recovery)) && fs::remove_dir_all(&staging).is_err() {
        eprintln!("Could not clean up an edit undo staging directory");
    }
    result?;
    Ok(UndoResponse::done(true))
}

fn preview(root: &Path, edits: &[Change], receipt: &Path) -> Result<RestorePreview> {
    fs::create_dir_all(receipt).map_err(|_| UndoError::Io)?;
    let staging = receipt.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&staging).map_err(|_| UndoError::Io)?;
    let result = files::preview(root, &staging, edits);
    if fs::remove_dir_all(&staging).is_err() {
        eprintln!("Could not remove an undo preview directory");
    }
    let (version, conflict) = result?;
    let paths = edits
        .iter()
        .flat_map(|edit| std::iter::once(edit.path.clone()).chain(edit.kind.move_path.clone()))
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    Ok(RestorePreview {
        files: paths,
        conflict,
        version,
    })
}

fn perform(
    root: &Path,
    edits: Vec<Change>,
    receipt: &Path,
    request: &UndoRequest,
) -> Result<UndoResponse> {
    if receipt.join("completed").is_file() {
        return Ok(UndoResponse::done(true));
    }
    let edits = normalized_changes(root, edits)?;
    if request.preview {
        let preview = preview(root, &edits, receipt)?;
        return Ok(UndoResponse {
            undone: false,
            preview: Some(preview),
        });
    }
    execute_version(root, edits, receipt, request.expected_version.as_deref())
}

async fn read_turn(state: &GuiState, request: &UndoRequest) -> Result<(String, Vec<Change>)> {
    let client = super::connected(state).await?;
    let header = client
        .request(
            "thread/read",
            json!({"threadId": request.thread_id, "includeTurns": false}),
        )
        .await?;
    if header["thread"]["id"] != request.thread_id {
        return Err(UndoError::Invalid);
    }
    if header["thread"]["status"]["type"] == "active" {
        return Err(UndoError::Busy);
    }
    let source =
        super::history_access::turn(&request.thread_id, &request.turn_id, |method, params| {
            client.request(method, params)
        })
        .await?;
    let home = client.home.clone();
    client.wait_for_reviews(&request.thread_id).await;
    let turn_id = request.turn_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut thread = source["thread"].clone();
        super::turn_review::restore(&home, &mut thread).map_err(|_| UndoError::Io)?;
        let edits = changes(&thread, &turn_id)?;
        let turn = thread["turns"]
            .as_array()
            .and_then(|turns| turns.iter().find(|turn| turn["id"] == turn_id))
            .ok_or(UndoError::Invalid)?;
        // Old histories without a bound cwd are reversible only when every recorded path is absolute.
        let absolute = edits.iter().all(|edit| {
            Path::new(&edit.path).is_absolute()
                && edit
                    .kind
                    .move_path
                    .as_ref()
                    .is_none_or(|path| Path::new(path).is_absolute())
        });
        let cwd = turn
            .get("reviewCwd")
            .or_else(|| absolute.then_some(&header["thread"]["cwd"]))
            .ok_or(UndoError::Invalid)?;
        Ok((cwd.as_str().ok_or(UndoError::Invalid)?.to_owned(), edits))
    })
    .await
    .map_err(|_| UndoError::Io)?
}

#[tauri::command]
pub(crate) async fn codex_gui_undo(
    app: AppHandle,
    state: State<'_, GuiState>,
    request: UndoRequest,
) -> std::result::Result<UndoResponse, String> {
    protocol::id(&request.thread_id)
        .and_then(|()| protocol::id(&request.turn_id))
        .map_err(|_| UndoError::Invalid.to_string())?;
    let receipt = receipt_path(&app, &request).map_err(|error| error.to_string())?;
    let guard = app.state::<GitState>().0.clone();
    if request.check_only {
        return tauri::async_runtime::spawn_blocking(move || {
            UndoResponse::done(receipt.join("completed").is_file())
        })
        .await
        .map_err(|_| UndoError::Io.to_string());
    }
    let (cwd, edits) = read_turn(&state, &request)
        .await
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard.lock().map_err(|_| UndoError::Io)?;
        let root = protocol::directory(&cwd).map_err(|_| UndoError::Invalid)?;
        perform(&root, edits, &receipt, &request)
    })
    .await
    .map_err(|_| UndoError::Io.to_string())?
    .map_err(|error| error.to_string())
}
