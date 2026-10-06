//! Task-scoped file handles with bounded reads, expiry and no whole-file buffering.
pub(crate) mod bulk;
#[cfg(test)]
mod bulk_tests;
#[cfg(test)]
mod download_tests;
mod file;
mod manifest;
#[cfg(test)]
mod preview_tests;
#[cfg(test)]
mod tests;

use super::{
    client::Client,
    error::{GuiError, Result},
    protocol::{thread_params, GuiResponse},
};
use file::StreamFile;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const CHUNK_BYTES: u64 = 256 * 1024;
const MAX_SESSIONS: usize = 16;
const IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StreamOpen {
    pub thread_id: String,
    pub path: String,
    pub max_bytes: u64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StreamRead {
    pub thread_id: String,
    pub id: String,
    pub offset: u64,
    pub length: u64,
    pub max_bytes: u64,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StreamClose {
    pub thread_id: String,
    pub id: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StreamInfo {
    id: String,
    size: u64,
    mime_type: String,
    name: String,
    revision: String,
}
#[derive(Serialize)]
pub(super) struct StreamChunk {
    offset: u64,
    data: String,
}

struct Session {
    thread_id: String,
    touched: Instant,
    file: Arc<Mutex<StreamFile>>,
    cancelled: Arc<AtomicBool>,
}
#[derive(Clone, Copy, Default)]
pub(super) enum StreamKind {
    #[default]
    Video,
    Download,
}

pub(crate) struct FileStreams {
    kind: StreamKind,
    sessions: Mutex<HashMap<String, Session>>,
    bulk_workers: Arc<tokio::sync::Semaphore>,
}

impl Default for FileStreams {
    fn default() -> Self {
        Self {
            kind: StreamKind::Video,
            sessions: Mutex::default(),
            bulk_workers: Arc::new(tokio::sync::Semaphore::new(2)),
        }
    }
}

fn response(value: impl Serialize) -> Result<GuiResponse> {
    Ok(GuiResponse {
        data: serde_json::to_value(value).map_err(|_| GuiError::FileRead)?,
    })
}

impl FileStreams {
    pub(super) fn insert_response(
        &self,
        root: PathBuf,
        options: StreamOpen,
    ) -> Result<GuiResponse> {
        response(self.insert(root, options)?)
    }

    pub(super) fn downloads() -> Self {
        Self {
            kind: StreamKind::Download,
            sessions: Mutex::default(),
            ..Self::default()
        }
    }

    pub(super) async fn open(
        self: Arc<Self>,
        client: &Client,
        options: StreamOpen,
    ) -> Result<GuiResponse> {
        let thread = client
            .request("thread/read", thread_params(options.thread_id.clone())?)
            .await?;
        let root = PathBuf::from(thread["thread"]["cwd"].as_str().ok_or(GuiError::FileRead)?);
        tauri::async_runtime::spawn_blocking(move || response(self.insert(root, options)?))
            .await
            .map_err(|_| GuiError::FileRead)?
    }

    fn insert(&self, root: PathBuf, options: StreamOpen) -> Result<StreamInfo> {
        let file = StreamFile::open(&root, &options.path, options.max_bytes, self.kind)?;
        self.insert_file(file, options.thread_id)
    }

    /// Only callers that have authorized and validated the complete preview may register a snapshot.
    pub(super) fn insert_preview(
        &self,
        transfer_id: String,
        bytes: &[u8],
        name: String,
        mime_type: String,
    ) -> Result<GuiResponse> {
        let file = StreamFile::snapshot(bytes, name, mime_type)?;
        response(self.insert_file(file, transfer_id)?)
    }

    fn insert_file(&self, file: StreamFile, thread_id: String) -> Result<StreamInfo> {
        let info = file.info();
        let mut sessions = self.sessions.lock().map_err(|_| GuiError::FileRead)?;
        sessions.retain(|_, session| session.retain());
        if sessions.len() >= MAX_SESSIONS {
            return Err(GuiError::FileBusy);
        }
        sessions.insert(
            info.id.clone(),
            Session {
                thread_id,
                touched: Instant::now(),
                cancelled: Arc::clone(&file.cancelled),
                file: Arc::new(Mutex::new(file)),
            },
        );
        Ok(info)
    }

    fn read_chunk(&self, options: StreamRead) -> Result<StreamChunk> {
        let file = self.authorized_file(&options.id, &options.thread_id)?;
        let mut file = file.lock().map_err(|_| GuiError::FileRead)?;
        file.read(&options)
    }

    fn authorized_file(&self, id: &str, thread_id: &str) -> Result<Arc<Mutex<StreamFile>>> {
        let mut sessions = self.sessions.lock().map_err(|_| GuiError::FileRead)?;
        sessions.retain(|_, session| session.retain());
        let session = sessions.get_mut(id).ok_or(GuiError::FileExpired)?;
        if session.thread_id != thread_id {
            return Err(GuiError::FileExpired);
        }
        session.touched = Instant::now();
        Ok(Arc::clone(&session.file))
    }

    pub(super) async fn read(self: Arc<Self>, options: StreamRead) -> Result<GuiResponse> {
        tauri::async_runtime::spawn_blocking(move || response(self.read_chunk(options)?))
            .await
            .map_err(|_| GuiError::FileRead)?
    }

    fn remove(&self, options: StreamClose) -> Result<()> {
        let mut sessions = self.sessions.lock().map_err(|_| GuiError::FileRead)?;
        if sessions
            .get(&options.id)
            .is_some_and(|session| session.thread_id != options.thread_id)
        {
            return Err(GuiError::FileExpired);
        }
        if let Some(session) = sessions.remove(&options.id) {
            session.cancelled.store(true, Ordering::Relaxed);
        }
        Ok(())
    }

    pub(super) async fn close(self: Arc<Self>, options: StreamClose) -> Result<GuiResponse> {
        tauri::async_runtime::spawn_blocking(move || {
            self.remove(options)?;
            response(())
        })
        .await
        .map_err(|_| GuiError::FileRead)?
    }
}

impl Session {
    fn retain(&self) -> bool {
        if self.touched.elapsed() < IDLE_TIMEOUT {
            return true;
        }
        self.cancelled.store(true, Ordering::Relaxed);
        false
    }
}
