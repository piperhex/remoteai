//! Immutable, disk-backed text views. Only a single UTF-8 window crosses IPC.
use super::*;
use std::{
    collections::HashMap,
    io::{Seek, SeekFrom},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, Instant},
};

const PAGE_BYTES: usize = 64 * 1024;
const MAX_VIEWS: usize = 32;
const IDLE: Duration = Duration::from_secs(15 * 60);
static VIEWS: OnceLock<Mutex<HashMap<String, Arc<View>>>> = OnceLock::new();

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct Request {
    token: String,
    #[serde(default)]
    offset: u64,
    #[serde(default)]
    end: Option<u64>,
    #[serde(default)]
    open: bool,
    #[serde(default)]
    cancel: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Window {
    token: String,
    offset: u64,
    end: u64,
    previous: u64,
}

struct Snapshot {
    file: File,
    revision: String,
    size: u64,
    read_only: bool,
}

enum Captured {
    Text(Snapshot),
    Binary(Document),
}

struct View {
    path: PathBuf,
    cancelled: AtomicBool,
    touched: Mutex<Instant>,
    snapshot: Mutex<Option<Snapshot>>,
}

fn views() -> &'static Mutex<HashMap<String, Arc<View>>> {
    VIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune() {
    let retired = {
        let Ok(mut registry) = views().lock() else {
            return;
        };
        let expired: Vec<_> = registry
            .iter()
            .filter(|(_, view)| view.touched.lock().is_ok_and(|time| time.elapsed() >= IDLE))
            .map(|(token, _)| token.clone())
            .collect();
        expired
            .iter()
            .filter_map(|token| registry.remove(token))
            .collect::<Vec<_>>()
    };
    for view in &retired {
        view.cancelled.store(true, Ordering::Relaxed);
    }
    // Closing snapshot handles can touch the filesystem; the registry is already unlocked.
    drop(retired);
}

pub(super) fn start_cleanup() -> Result<()> {
    static WORKER: OnceLock<std::io::Result<()>> = OnceLock::new();
    WORKER
        .get_or_init(|| {
            std::thread::Builder::new()
                .name("project-view-cleanup".into())
                .spawn(|| loop {
                    std::thread::sleep(Duration::from_secs(60));
                    prune();
                    transfer::prune();
                })
                .map(|handle| {
                    // One process-lifetime cleanup worker; view cancellation itself never waits for this timer.
                    drop(handle);
                })
        })
        .as_ref()
        .map(|_| ())
        .map_err(|_| GuiError::FileBusy)
}

fn view(path: &Path, request: &Request) -> Result<Arc<View>> {
    if uuid::Uuid::parse_str(&request.token).is_err() {
        return Err(GuiError::InvalidRequest);
    }
    start_cleanup()?;
    prune();
    let mut registry = views().lock().map_err(|_| GuiError::FileBusy)?;
    if let Some(view) = registry.get(&request.token) {
        if view.path != path {
            return Err(GuiError::InvalidRequest);
        }
        *view.touched.lock().map_err(|_| GuiError::FileBusy)? = Instant::now();
        return Ok(Arc::clone(view));
    }
    if !request.open {
        return Err(GuiError::FileExpired);
    }
    if registry.len() >= MAX_VIEWS {
        return Err(GuiError::FileBusy);
    }
    let view = Arc::new(View {
        path: path.to_owned(),
        cancelled: AtomicBool::new(false),
        touched: Mutex::new(Instant::now()),
        snapshot: Mutex::new(None),
    });
    registry.insert(request.token.clone(), Arc::clone(&view));
    Ok(view)
}

fn cancel(path: &Path, token: &str) -> Result<GuiResponse> {
    let mut registry = views().lock().map_err(|_| GuiError::FileBusy)?;
    if registry.get(token).is_some_and(|view| view.path != path) {
        return Err(GuiError::InvalidRequest);
    }
    let retired = registry.remove(token);
    if let Some(view) = &retired {
        view.cancelled.store(true, Ordering::Relaxed);
    }
    drop(registry);
    drop(retired);
    Ok(GuiResponse {
        data: serde_json::Value::Null,
    })
}

fn cancel_target(target: &Target, token: &str) -> Result<GuiResponse> {
    super::super::local_file::validate(&target.cwd)?;
    super::super::local_file::validate(&target.path)?;
    if !Path::new(&target.cwd).is_absolute() || uuid::Uuid::parse_str(token).is_err() {
        return Err(GuiError::InvalidRequest);
    }
    let root = Path::new(&target.cwd)
        .canonicalize()
        .map_err(|_| GuiError::ProjectFiles)?;
    let requested = resolve(target).unwrap_or_else(|_| root.join(&target.path));
    let path = {
        let registry = views().lock().map_err(|_| GuiError::FileBusy)?;
        let Some(view) = registry.get(token) else {
            return Ok(GuiResponse {
                data: serde_json::Value::Null,
            });
        };
        // The original file may have been moved/deleted. Release only a view in this project
        // whose saved canonical name matches; cancellation never opens a replacement file.
        if !view.path.starts_with(&root) || execution_path(&view.path) != execution_path(&requested)
        {
            return Err(GuiError::InvalidRequest);
        }
        view.path.clone()
    };
    cancel(&path, token)
}

fn capture(path: &Path, cancelled: &AtomicBool) -> Result<Snapshot> {
    match capture_file(path, cancelled)? {
        Captured::Text(snapshot) => Ok(snapshot),
        Captured::Binary(_) => Err(GuiError::TextPreview),
    }
}

fn capture_file(path: &Path, cancelled: &AtomicBool) -> Result<Captured> {
    let mut source = File::open(path).map_err(|_| GuiError::FileRead)?;
    let before = source.metadata().map_err(|_| GuiError::FileRead)?;
    // Anonymous files are deleted by the OS when their last handle closes, including process exit.
    let mut file = tempfile::tempfile().map_err(|_| GuiError::ProjectFileWrite)?;
    let scan = stream::scan(&mut source, Some(&mut file), 0, Some(cancelled))?;
    stream::unchanged(path, &before)?;
    // Binary files need metadata for the media preview, never an editable UTF-8 window.
    if !scan.text {
        return Ok(Captured::Binary(Document {
            path: execution_path(path),
            kind: "binary",
            size: scan.size,
            text: None,
            image: None,
            revision: scan.revision,
            read_only: true,
            chunked: false,
            window: None,
        }));
    }
    // A second streamed digest detects changes even when another writer restores size/mtime.
    source
        .seek(SeekFrom::Start(0))
        .map_err(|_| GuiError::FileRead)?;
    let verified = stream::scan(&mut source, None, 0, Some(cancelled))?;
    if verified.revision != scan.revision {
        return Err(GuiError::ProjectFileConflict);
    }
    stream::unchanged(path, &before)?;
    Ok(Captured::Text(Snapshot {
        file,
        revision: scan.revision,
        size: scan.size,
        read_only: before.permissions().readonly(),
    }))
}

pub(super) fn read(target: Target) -> Result<GuiResponse> {
    let request = target.window.as_ref().ok_or(GuiError::InvalidRequest)?;
    if target.chunk.is_some() {
        return Err(GuiError::InvalidRequest);
    }
    if request.cancel {
        return cancel_target(&target, &request.token);
    }
    let path = resolve(&target)?;
    // Register before waiting for the file claim, so cancellation can reach the worker.
    let view = view(&path, request)?;
    let result = read_view(&target, &view, request);
    if result.is_err() || result.as_ref().is_ok_and(|doc| doc.window.is_none()) {
        cancel(&path, &request.token)?;
    }
    result.and_then(response)
}

fn read_view(target: &Target, view: &View, request: &Request) -> Result<Document> {
    let mut slot = view.snapshot.lock().map_err(|_| GuiError::FileBusy)?;
    if view.cancelled.load(Ordering::Relaxed) {
        return Err(GuiError::FileExpired);
    }
    if slot.is_none() {
        let _guard = locks::acquire_cancellable(&view.path, false, Some(&view.cancelled))?;
        if resolve(target)? != view.path {
            return Err(GuiError::ProjectFileConflict);
        }
        let metadata = fs::metadata(&view.path).map_err(|_| GuiError::FileRead)?;
        if metadata.len() <= INLINE_BYTES as u64
            || image_mime(&view.path).is_some()
            || is_pdf(&view.path)
        {
            return snapshot(&view.path);
        }
        match capture_file(&view.path, &view.cancelled)? {
            Captured::Text(snapshot) => *slot = Some(snapshot),
            Captured::Binary(document) => return Ok(document),
        }
    }
    page(
        &view.path,
        slot.as_mut().ok_or(GuiError::FileExpired)?,
        request,
    )
}

fn boundary(file: &mut File, offset: u64, size: u64) -> Result<u64> {
    if offset == 0 || offset == size {
        return Ok(offset);
    }
    file.seek(SeekFrom::Start(offset - 1))
        .map_err(|_| GuiError::FileRead)?;
    let mut bytes = [0; 5];
    let count = file.read(&mut bytes).map_err(|_| GuiError::FileRead)?;
    let mut skip = 1;
    while skip < count && bytes[skip] & 0xc0 == 0x80 {
        skip += 1;
    }
    if bytes[0] == b'\r' && bytes.get(1) == Some(&b'\n') {
        skip = 2;
    }
    Ok((offset + skip as u64 - 1).min(size))
}

fn page(path: &Path, snapshot: &mut Snapshot, request: &Request) -> Result<Document> {
    if request.offset > snapshot.size {
        return Err(GuiError::InvalidRequest);
    }
    let file = &mut snapshot.file;
    let offset = boundary(file, request.offset, snapshot.size)?;
    let requested_end = request
        .end
        .unwrap_or_else(|| (offset + PAGE_BYTES as u64).min(snapshot.size));
    if requested_end < offset
        || requested_end > snapshot.size
        || requested_end - offset > INLINE_BYTES as u64 + 4
    {
        return Err(GuiError::InvalidRequest);
    }
    let end = boundary(file, requested_end, snapshot.size)?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|_| GuiError::FileRead)?;
    let mut bytes = vec![0; (end - offset) as usize];
    file.read_exact(&mut bytes)
        .map_err(|_| GuiError::FileRead)?;
    let text = String::from_utf8(bytes).map_err(|_| GuiError::FileRead)?;
    Ok(Document {
        path: execution_path(path),
        kind: "text",
        size: snapshot.size,
        text: Some(text),
        image: None,
        revision: snapshot.revision.clone(),
        read_only: snapshot.read_only,
        chunked: false,
        window: Some(Window {
            token: request.token.clone(),
            offset,
            end,
            previous: offset.saturating_sub(PAGE_BYTES as u64 + 4),
        }),
    })
}

#[path = "window_save.rs"]
mod saving;
pub(super) use saving::save;

#[cfg(test)]
#[path = "windows_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "binary_tests.rs"]
mod binary_tests;
