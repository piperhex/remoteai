//! Staged uploads keep relay packets small and preserve the original file until the final revision check.
use super::*;
use std::{
    collections::HashMap,
    io::{Seek, SeekFrom},
    sync::OnceLock,
    time::{Duration, Instant},
};

const MAX_UPLOADS: usize = 8;
const UPLOAD_IDLE: Duration = Duration::from_secs(15 * 60);
static UPLOADS: OnceLock<Mutex<HashMap<String, Slot>>> = OnceLock::new();

#[derive(Debug, Deserialize, Clone)]
pub(super) struct ReadRange {
    offset: u64,
    length: usize,
}

#[derive(Debug, Deserialize)]
pub(super) struct UploadChunk {
    token: String,
    offset: u64,
    size: u64,
    data: String,
    #[serde(default)]
    finish: bool,
    #[serde(default)]
    cancel: bool,
}

struct Slot {
    path: PathBuf,
    revision: String,
    size: u64,
    updated: Instant,
    upload: Option<Upload>,
}

struct Upload {
    target: Target,
    path: PathBuf,
    revision: String,
    size: u64,
    received: u64,
    staged: tempfile::NamedTempFile,
}

pub(super) fn read_chunk(path: &Path, range: &ReadRange) -> Result<GuiResponse> {
    if range.length == 0 || range.length > INLINE_BYTES {
        return Err(GuiError::InvalidRequest);
    }
    let mut file = File::open(path).map_err(|_| GuiError::FileRead)?;
    let end = range
        .offset
        .checked_add(range.length as u64)
        .ok_or(GuiError::InvalidRequest)?;
    if end > file.metadata().map_err(|_| GuiError::FileRead)?.len() {
        return Err(GuiError::InvalidRequest);
    }
    file.seek(SeekFrom::Start(range.offset))
        .map_err(|_| GuiError::FileRead)?;
    let mut bytes = vec![0; range.length];
    file.read_exact(&mut bytes)
        .map_err(|_| GuiError::ProjectFileConflict)?;
    Ok(GuiResponse {
        data: serde_json::json!({ "data": STANDARD.encode(bytes) }),
    })
}

fn create(request: &Save, path: PathBuf, chunk: &UploadChunk) -> Result<Upload> {
    let current = snapshot(&path)?;
    if current.read_only || current.kind != "text" {
        return Err(GuiError::ProjectFileWrite);
    }
    if current.revision != request.revision {
        return Err(GuiError::ProjectFileConflict);
    }
    let parent = path.parent().ok_or(GuiError::ProjectFileWrite)?;
    let staged = tempfile::NamedTempFile::new_in(parent).map_err(|_| GuiError::ProjectFileWrite)?;
    Ok(Upload {
        target: request.target.clone(),
        path,
        revision: request.revision.clone(),
        size: chunk.size,
        received: 0,
        staged,
    })
}

fn append(upload: &mut Upload, chunk: &UploadChunk, bytes: &[u8]) -> Result<()> {
    let end = chunk
        .offset
        .checked_add(bytes.len() as u64)
        .ok_or(GuiError::InvalidRequest)?;
    if end > upload.size || chunk.offset > upload.received {
        return Err(GuiError::InvalidRequest);
    }
    let file = upload.staged.as_file_mut();
    file.seek(SeekFrom::Start(chunk.offset))
        .map_err(|_| GuiError::ProjectFileWrite)?;
    if chunk.offset < upload.received {
        if end > upload.received {
            return Err(GuiError::InvalidRequest);
        }
        let mut existing = vec![0; bytes.len()];
        file.read_exact(&mut existing)
            .map_err(|_| GuiError::ProjectFileWrite)?;
        if existing != bytes {
            return Err(GuiError::InvalidRequest);
        }
    } else {
        file.write_all(bytes)
            .map_err(|_| GuiError::ProjectFileWrite)?;
        upload.received = end;
    }
    Ok(())
}

fn finish(upload: Upload) -> Result<GuiResponse> {
    if upload.received != upload.size {
        return Err(GuiError::InvalidRequest);
    }
    let mut document = snapshot(upload.staged.path())?;
    if document.kind != "text" {
        return Err(GuiError::ProjectFileWrite);
    }
    let permissions = fs::metadata(&upload.path)
        .map_err(|_| GuiError::FileRead)?
        .permissions();
    if permissions.readonly() {
        return Err(GuiError::ProjectFileWrite);
    }
    upload
        .staged
        .as_file()
        .set_permissions(permissions)
        .and_then(|()| upload.staged.as_file().sync_all())
        .map_err(|_| GuiError::ProjectFileWrite)?;
    if stream::inspect(&upload.path)?.revision != upload.revision
        || resolve(&upload.target)? != upload.path
    {
        return Err(GuiError::ProjectFileConflict);
    }
    document.path = execution_path(&upload.path);
    let reply = response(document)?;
    upload
        .staged
        .persist(&upload.path)
        .map_err(|_| GuiError::ProjectFileWrite)?;
    Ok(reply)
}

pub(super) fn prune() {
    let Some(registry) = UPLOADS.get() else {
        return;
    };
    let Ok(mut uploads) = registry.lock() else {
        return;
    };
    let expired: Vec<_> = uploads
        .iter()
        .filter(|(_, slot)| slot.upload.is_some() && slot.updated.elapsed() >= UPLOAD_IDLE)
        .map(|(token, _)| token.clone())
        .collect();
    let retired: Vec<_> = expired
        .iter()
        .filter_map(|token| uploads.remove(token))
        .collect();
    drop(uploads);
    drop(retired);
}

fn take_upload(request: &Save, path: &Path, chunk: &UploadChunk) -> Result<Option<Upload>> {
    windows::start_cleanup()?;
    prune();
    let mut uploads = UPLOADS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| GuiError::FileBusy)?;
    if let Some(slot) = uploads.get_mut(&chunk.token) {
        if slot.path != path || slot.revision != request.revision || slot.size != chunk.size {
            return Err(GuiError::InvalidRequest);
        }
        let upload = slot.upload.take();
        drop(uploads);
        return upload.map(Some).ok_or(GuiError::FileBusy);
    }
    if chunk.offset != 0 || uploads.len() >= MAX_UPLOADS {
        return Err(GuiError::FileBusy);
    }
    uploads.insert(
        chunk.token.clone(),
        Slot {
            path: path.to_owned(),
            revision: request.revision.clone(),
            size: chunk.size,
            updated: Instant::now(),
            upload: None,
        },
    );
    drop(uploads);
    Ok(None)
}

fn restore(token: &str, upload: Option<Upload>) -> Result<()> {
    let mut uploads = UPLOADS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| GuiError::FileBusy)?;
    let retired = if let Some(upload) = upload {
        let slot = uploads.get_mut(token).ok_or(GuiError::InvalidRequest)?;
        slot.updated = Instant::now();
        slot.upload = Some(upload);
        None
    } else {
        uploads.remove(token)
    };
    drop(uploads);
    drop(retired);
    Ok(())
}

pub(super) fn write(request: Save) -> Result<GuiResponse> {
    let chunk = request.upload.as_ref().ok_or(GuiError::InvalidRequest)?;
    if uuid::Uuid::parse_str(&chunk.token).is_err()
        || chunk.data.len() > INLINE_BYTES.div_ceil(3) * 4
    {
        return Err(GuiError::InvalidRequest);
    }
    let path = resolve(&request.target)?;
    let _guard = locks::acquire(&path, false)?;
    if resolve(&request.target)? != path {
        return Err(GuiError::ProjectFileConflict);
    }
    let existing = take_upload(&request, &path, chunk)?;
    if chunk.cancel {
        restore(&chunk.token, None)?;
        return Ok(GuiResponse {
            data: serde_json::Value::Null,
        });
    }
    let result = (|| {
        let mut upload = match existing {
            Some(upload) => upload,
            None => create(&request, path, chunk)?,
        };
        let bytes = STANDARD
            .decode(&chunk.data)
            .map_err(|_| GuiError::InvalidRequest)?;
        if bytes.is_empty() || bytes.len() > INLINE_BYTES {
            return Err(GuiError::InvalidRequest);
        }
        append(&mut upload, chunk, &bytes)?;
        if chunk.finish {
            return finish(upload);
        }
        let received = upload.received;
        restore(&chunk.token, Some(upload))?;
        Ok(GuiResponse {
            data: serde_json::json!({ "received": received }),
        })
    })();
    if chunk.finish || result.is_err() {
        restore(&chunk.token, None)?;
    }
    result
}
