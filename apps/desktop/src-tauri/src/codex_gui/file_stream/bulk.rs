//! Bulk control requests use RPC; verified block payloads leave Rust through binary IPC only.
use super::super::{
    error::{GuiError, Result},
    protocol::GuiResponse,
};
use super::{response, FileStreams};
use serde::Deserialize;
use std::sync::Arc;

/// The IPC response is binary; it cannot accidentally be fragmented into the legacy chat RPC window.
#[tauri::command]
pub(crate) async fn codex_gui_file_bulk_read(
    state: tauri::State<'_, super::super::GuiState>,
    request: BlockRead,
) -> std::result::Result<tauri::ipc::Response, String> {
    Arc::clone(&state.downloads.0)
        .bulk_read(request)
        .await
        .map(tauri::ipc::Response::new)
        .map_err(|error| match error {
            GuiError::FileChanged => "SOURCE_CHANGED".to_string(),
            _ => error.to_string(),
        })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ManifestRead {
    pub thread_id: String,
    pub id: String,
    pub max_bytes: u64,
    pub page: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BlockRead {
    pub thread_id: String,
    pub id: String,
    pub manifest_id: String,
    pub block: usize,
    pub max_bytes: u64,
}

impl FileStreams {
    pub(in super::super) async fn manifest(
        self: Arc<Self>,
        request: ManifestRead,
    ) -> Result<GuiResponse> {
        // An independent, bounded budget prevents prescans from occupying every blocking worker.
        let permit = self
            .bulk_workers
            .clone()
            .try_acquire_owned()
            .map_err(|_| GuiError::FileBusy)?;
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            let file = self.authorized_file(&request.id, &request.thread_id)?;
            let mut file = file.lock().map_err(|_| GuiError::FileRead)?;
            let manifest = file
                .manifest(request.max_bytes)
                .map_err(|error| match error {
                    GuiError::FileChanged => GuiError::FileSourceChanged,
                    other => other,
                })?;
            match request.page {
                Some(page) => response(manifest.page(page)?),
                None => response(&manifest.info),
            }
        })
        .await
        .map_err(|_| GuiError::FileRead)?
    }

    pub(in super::super) async fn bulk_read(
        self: Arc<Self>,
        request: BlockRead,
    ) -> Result<Vec<u8>> {
        let permit = self
            .bulk_workers
            .clone()
            .try_acquire_owned()
            .map_err(|_| GuiError::FileBusy)?;
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            let file = self.authorized_file(&request.id, &request.thread_id)?;
            let result = file
                .lock()
                .map_err(|_| GuiError::FileRead)?
                .bulk_read(&request);
            result
        })
        .await
        .map_err(|_| GuiError::FileRead)?
    }
}
