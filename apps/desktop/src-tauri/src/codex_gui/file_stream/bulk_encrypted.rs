//! Authenticated file handles own bounded block caches and encryption keys until close/expiry.
use super::super::error::{GuiError, Result};
use super::{
    bulk::BlockRead,
    bulk_cipher::{Batch, Sender},
    file::StreamFile,
    FileStreams,
};
use serde::Deserialize;
use std::sync::{atomic::Ordering, Arc};
use uuid::Uuid;
use zeroize::Zeroize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OpenSender {
    pub thread_id: String,
    pub id: String,
    pub manifest_id: String,
    pub epoch: Uuid,
    pub key: [u8; 32],
    pub record_bytes: usize,
    pub max_bytes: u64,
}

impl Drop for OpenSender {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadBatch {
    pub source: BlockRead,
    pub epoch: Uuid,
    pub request_id: Uuid,
    pub offset: usize,
}

pub(super) fn boundary_error(error: GuiError) -> String {
    match error {
        GuiError::FileChanged => "SOURCE_CHANGED",
        GuiError::FileExpired => "EPOCH_EXPIRED",
        GuiError::FileBusy => "RESOURCE_LIMIT",
        GuiError::InvalidRequest => "INVALID_RECORD",
        _ => "FILE_UNAVAILABLE",
    }
    .into()
}

#[tauri::command]
pub(crate) async fn codex_gui_file_bulk_sender_open(
    state: tauri::State<'_, super::super::GuiState>,
    request: OpenSender,
) -> std::result::Result<(), String> {
    Arc::clone(&state.downloads.0)
        .sender_open(request)
        .await
        .map_err(boundary_error)
}

#[tauri::command]
pub(crate) async fn codex_gui_file_bulk_sender_read(
    state: tauri::State<'_, super::super::GuiState>,
    request: ReadBatch,
) -> std::result::Result<tauri::ipc::Response, String> {
    Arc::clone(&state.downloads.0)
        .sender_read(request)
        .await
        .map(tauri::ipc::Response::new)
        .map_err(boundary_error)
}

impl FileStreams {
    async fn sender_open(self: Arc<Self>, request: OpenSender) -> Result<()> {
        let permit = self
            .bulk_workers
            .clone()
            .try_acquire_owned()
            .map_err(|_| GuiError::FileBusy)?;
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            let file = self.authorized_file(&request.id, &request.thread_id)?;
            let mut file = file.lock().map_err(|_| GuiError::FileRead)?;
            file.open_sender(&request)
        })
        .await
        .map_err(|_| GuiError::FileRead)?
    }

    pub(super) async fn sender_read(self: Arc<Self>, request: ReadBatch) -> Result<Vec<u8>> {
        let permit = self
            .bulk_workers
            .clone()
            .try_acquire_owned()
            .map_err(|_| GuiError::FileBusy)?;
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            let file = self.authorized_file(&request.source.id, &request.source.thread_id)?;
            let mut file = file.lock().map_err(|_| GuiError::FileRead)?;
            file.sender_batch(&request)
        })
        .await
        .map_err(|_| GuiError::FileRead)?
    }
}

impl StreamFile {
    pub(super) fn open_sender(&mut self, request: &OpenSender) -> Result<()> {
        if self.cancelled.load(Ordering::Relaxed) || self.bulk_sender.is_some() {
            return Err(GuiError::FileExpired);
        }
        if self.manifest(request.max_bytes)?.info.manifest_id != request.manifest_id {
            return Err(GuiError::FileChanged);
        }
        self.bulk_sender = Some(Sender::new(request)?);
        Ok(())
    }

    pub(super) fn sender_batch(&mut self, request: &ReadBatch) -> Result<Vec<u8>> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(GuiError::FileExpired);
        }
        let mut sender = self.bulk_sender.take().ok_or(GuiError::FileExpired)?;
        let result = sender.batch(
            Batch {
                epoch: request.epoch,
                manifest: &request.source.manifest_id,
                request: request.request_id,
                block: request.source.block,
                offset: request.offset,
            },
            || self.bulk_read(&request.source),
        );
        self.bulk_sender = Some(sender);
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(GuiError::FileExpired);
        }
        result
    }
}
