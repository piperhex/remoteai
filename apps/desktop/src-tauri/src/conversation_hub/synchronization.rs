use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::io::{Seek, SeekFrom};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

mod archive;
mod persistence;
mod planning;
#[cfg(test)]
mod tests;

const CHUNK_BYTES: usize = 256 * 1024;
const LEGACY_CHUNK_BYTES: usize = 12 * 1024;
const MAX_TRANSFERS: usize = 64;
const TRANSFER_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const INVALID: &str = "CONVERSATION_SYNC_INVALID";
const FAILED: &str = "CONVERSATION_SYNC_FAILED";
const CHANGED: &str = "CONVERSATION_SYNC_CHANGED";

#[derive(Debug, thiserror::Error)]
enum SyncError {
    #[error("invalid synchronization request")]
    Invalid,
    #[error("conversation changed after synchronization preview")]
    Changed,
    #[error("synchronization storage failed: {0}")]
    Storage(String),
}

impl From<String> for SyncError {
    fn from(detail: String) -> Self {
        match detail.as_str() {
            INVALID => Self::Invalid,
            CHANGED => Self::Changed,
            _ => Self::Storage(detail),
        }
    }
}

static TRANSFERS: LazyLock<Mutex<HashMap<String, Transfer>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Deserialize)]
struct Transfer {
    root: PathBuf,
    size: u64,
    sha256: String,
    written: u64,
    source: Option<PathBuf>,
    plan: Option<planning::Plan>,
    #[serde(skip, default = "Instant::now")]
    touched: Instant,
    retain: bool,
    #[serde(default)]
    original_size: u64,
    #[serde(default)]
    resume_token: String,
}

impl Drop for Transfer {
    fn drop(&mut self) {
        if self.retain || !self.resume_token.is_empty() {
            return;
        }
        if let Err(error) = fs::remove_dir_all(&self.root) {
            if error.kind() != std::io::ErrorKind::NotFound {
                crate::error_logs::record_codex_error(&format!(
                    "Conversation sync cleanup: {error}"
                ));
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum SyncRequest {
    Homes,
    List {
        home_id: String,
        query: Option<String>,
    },
    Prepare {
        home_id: String,
        session_ids: Vec<String>,
    },
    Export {
        home_id: String,
        session_ids: Vec<String>,
    },
    Read {
        id: String,
        offset: u64,
        length: Option<usize>,
    },
    Begin {
        size: u64,
        sha256: String,
    },
    Write {
        id: String,
        offset: u64,
        data: String,
    },
    Plan {
        id: String,
        session_ids: Option<Vec<String>>,
    },
    Commit {
        id: String,
        overwrite_ids: Vec<String>,
        model_provider: super::home_migration_provider::MigrationModelProvider,
    },
    Close {
        id: String,
    },
    Resume {
        id: String,
        resume_token: String,
    },
}

#[tauri::command]
pub(crate) async fn codex_conversation_sync<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    request: SyncRequest,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run(app, request))
        .await
        .map_err(|error| boundary_error(&SyncError::Storage(error.to_string())))?
        .map_err(|error| boundary_error(&error))
}

fn boundary_error(error: &SyncError) -> String {
    match error {
        SyncError::Invalid => return INVALID.to_owned(),
        SyncError::Changed => return CHANGED.to_owned(),
        SyncError::Storage(_) => {}
    }
    crate::error_logs::record_codex_error(&format!("Conversation sync: {error}"));
    FAILED.to_owned()
}

fn run<R: Runtime>(app: tauri::AppHandle<R>, request: SyncRequest) -> Result<Value, SyncError> {
    // Legacy rollout and SQLite helpers return strings. Convert them at this service boundary,
    // keeping their diagnostics internal and exposing stable synchronization failures to callers.
    execute(app, request).map_err(SyncError::from)
}

fn transfer_root<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("conversation-sync");
    persistence::prune(&cache)?;
    let root = cache.join(Uuid::new_v4().to_string());
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn execute<R: Runtime>(app: tauri::AppHandle<R>, request: SyncRequest) -> Result<Value, String> {
    match request {
        SyncRequest::Homes => homes(&app),
        SyncRequest::List { home_id, query } => {
            serde_json::to_value(browse_codex_threads_blocking(
                ThreadContext::new(app, Some(home_id))?,
                query.clone(),
                query,
            )?)
            .map_err(|e| e.to_string())
        }
        SyncRequest::Prepare {
            home_id,
            session_ids,
        } => prepare(&app, &home_id, session_ids, false),
        SyncRequest::Export {
            home_id,
            session_ids,
        } => prepare(&app, &home_id, session_ids, true),
        SyncRequest::Begin { size, sha256 } => begin(&app, size, sha256),
        SyncRequest::Resume { id, resume_token } => persistence::resume(&app, &id, &resume_token),
        other => with_transfer(&app, other),
    }
}

fn homes<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Value, String> {
    let settings = crate::storage::read_app_settings(app)?;
    Ok(
        json!({ "name": sysinfo::System::host_name().unwrap_or_else(|| "PC".into()),
        "homes": settings.codex_homes }),
    )
}

fn register(mut transfer: Transfer) -> Result<Value, String> {
    let mut transfers = TRANSFERS.lock().map_err(|_| FAILED.to_owned())?;
    transfers.retain(|_, entry| {
        if entry.touched.elapsed() < TRANSFER_TTL {
            return true;
        }
        entry.resume_token.clear();
        false
    });
    if transfers.len() >= MAX_TRANSFERS {
        return Err(INVALID.into());
    }
    let id = transfer
        .root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(INVALID)?
        .to_owned();
    let mut result = persistence::description(&id, &transfer)?;
    transfer.resume_token = Uuid::new_v4().to_string();
    if let Err(error) = persistence::save(&transfer) {
        transfer.resume_token.clear();
        return Err(error);
    }
    result["resumeToken"] = json!(transfer.resume_token);
    transfers.insert(id, transfer);
    Ok(result)
}

fn prepare<R: Runtime>(
    app: &tauri::AppHandle<R>,
    home: &str,
    ids: Vec<String>,
    export: bool,
) -> Result<Value, String> {
    let source = crate::codex_home::resolve_selected(app, Some(home))?;
    let root = transfer_root(app)?;
    let mut transfer = Transfer {
        root,
        size: 0,
        sha256: String::new(),
        written: 0,
        source: (!export).then(|| source.clone()),
        plan: None,
        touched: Instant::now(),
        retain: false,
        original_size: 0,
        resume_token: String::new(),
    };
    let _guard = bin_operation_guard()?;
    archive::snapshot_source(&source, &transfer.root, ids)?;
    transfer.original_size = archive::original_size(&transfer.root)?;
    archive::pack(&transfer.root)?;
    let path = transfer.root.join("bundle.zip");
    transfer.size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    transfer.sha256 = sha256(&path)?;
    transfer.written = transfer.size;
    register(transfer)
}

fn begin<R: Runtime>(app: &tauri::AppHandle<R>, size: u64, hash: String) -> Result<Value, String> {
    if size == 0 || hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(INVALID.into());
    }
    let transfer = Transfer {
        root: transfer_root(app)?,
        size,
        sha256: hash,
        written: 0,
        source: None,
        plan: None,
        touched: Instant::now(),
        retain: false,
        original_size: 0,
        resume_token: String::new(),
    };
    File::create(transfer.root.join("bundle.zip")).map_err(|e| e.to_string())?;
    register(transfer)
}

fn with_transfer<R: Runtime>(
    app: &tauri::AppHandle<R>,
    request: SyncRequest,
) -> Result<Value, String> {
    let id = match &request {
        SyncRequest::Read { id, .. }
        | SyncRequest::Write { id, .. }
        | SyncRequest::Plan { id, .. }
        | SyncRequest::Commit { id, .. }
        | SyncRequest::Close { id } => id,
        _ => return Err(INVALID.into()),
    };
    let mut transfers = TRANSFERS.lock().map_err(|_| FAILED.to_owned())?;
    if matches!(request, SyncRequest::Close { .. }) {
        if let Some(entry) = transfers.get(id).filter(|entry| !entry.retain) {
            match fs::remove_dir_all(&entry.root) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        if let Some(mut entry) = transfers.remove(id) {
            entry.resume_token.clear();
        }
        return Ok(json!({}));
    }
    let entry = transfers
        .get_mut(id)
        .filter(|entry| entry.touched.elapsed() < TRANSFER_TTL)
        .ok_or_else(|| INVALID.to_owned())?;
    entry.touched = Instant::now();
    let result = match request {
        SyncRequest::Read { offset, length, .. } => return read(entry, offset, length),
        SyncRequest::Write { offset, data, .. } => write(entry, offset, &data),
        SyncRequest::Plan { session_ids, .. } => planning::preview(app, entry, session_ids),
        SyncRequest::Commit {
            overwrite_ids,
            model_provider,
            ..
        } => planning::commit(app, entry, overwrite_ids, model_provider),
        _ => Err(INVALID.into()),
    };
    // Persist acknowledgements only after the file operation and plan update succeed.
    if result.is_ok() {
        persistence::save(entry)?;
    }
    result
}

fn read(entry: &Transfer, offset: u64, length: Option<usize>) -> Result<Value, String> {
    let length = length.unwrap_or(LEGACY_CHUNK_BYTES);
    if offset >= entry.size || length == 0 || length > CHUNK_BYTES {
        return Err(INVALID.into());
    }
    let mut file = File::open(entry.root.join("bundle.zip")).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut bytes = vec![0; length.min((entry.size - offset) as usize)];
    file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    Ok(json!({ "data": STANDARD.encode(bytes) }))
}

fn write(entry: &mut Transfer, offset: u64, encoded: &str) -> Result<Value, String> {
    if entry
        .plan
        .as_ref()
        .is_some_and(|plan| plan.result.is_some())
        || encoded.len() > CHUNK_BYTES * 2
    {
        return Err(INVALID.into());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| INVALID.to_owned())?;
    if bytes.is_empty()
        || bytes.len() > CHUNK_BYTES
        || offset > entry.written
        || offset + bytes.len() as u64 > entry.size
    {
        return Err(INVALID.into());
    }
    let mut file = File::options()
        .read(true)
        .write(true)
        .open(entry.root.join("bundle.zip"))
        .map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    if offset < entry.written {
        if offset + bytes.len() as u64 > entry.written {
            return Err(INVALID.into());
        }
        let mut previous = vec![0; bytes.len()];
        file.read_exact(&mut previous).map_err(|e| e.to_string())?;
        if previous != bytes {
            return Err(INVALID.into());
        }
    } else {
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        entry.written += bytes.len() as u64;
    }
    Ok(json!({ "written": entry.written }))
}
