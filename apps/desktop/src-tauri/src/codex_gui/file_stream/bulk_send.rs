//! Reading and encryption stay on the file worker; the resulting bounded batch goes straight to native RTC.
use super::{bulk_encrypted::ReadBatch, FileStreams};
use crate::native_rtc::bulk::{Sent, Target};
use serde::Deserialize;
use std::sync::{atomic::AtomicBool, Arc};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SendBatch {
    batch: ReadBatch,
    target: Target,
}

#[tauri::command]
pub(crate) async fn codex_gui_file_bulk_sender_send(
    app: tauri::AppHandle,
    window: tauri::Webview,
    request: SendBatch,
) -> std::result::Result<Sent, String> {
    if window.label() != "main" {
        return Err("PATH_UNAVAILABLE".into());
    }
    let streams = Arc::clone(&app.state::<super::super::GuiState>().downloads.0);
    let native = app.state::<crate::native_rtc::State>();
    // Reject a stale transport before allocating any new file nonce.
    native
        .get(window.label(), &request.target.peer)
        .await
        .map_err(crate::native_rtc::boundary)?;
    let cancelled = streams
        .clone()
        .sender_cancellation(&request.batch)
        .await
        .map_err(super::bulk_encrypted::boundary_error)?;
    let batch = streams
        .sender_read(request.batch)
        .await
        .map_err(super::bulk_encrypted::boundary_error)?;
    native
        .send_file(window.label(), (&request.target, batch.into()), &cancelled)
        .await
        .map_err(crate::native_rtc::boundary)
}

impl FileStreams {
    async fn sender_cancellation(
        self: Arc<Self>,
        request: &ReadBatch,
    ) -> super::super::error::Result<Arc<AtomicBool>> {
        let (id, thread_id) = (request.source.id.clone(), request.source.thread_id.clone());
        tauri::async_runtime::spawn_blocking(move || {
            let file = self.authorized_file(&id, &thread_id)?;
            let file = file
                .lock()
                .map_err(|_| super::super::error::GuiError::FileRead)?;
            Ok(file.cancelled.clone())
        })
        .await
        .map_err(|_| super::super::error::GuiError::FileRead)?
    }
}
