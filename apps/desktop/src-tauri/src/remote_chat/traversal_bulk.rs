//! Pull bounded raw batches so a suspended renderer cannot accumulate file callbacks.
use std::{future::Future, time::Duration};

use futures_util::FutureExt;
use tauri::{ipc::Response, AppHandle, Manager, Webview};

use super::{authorize, State, UNAVAILABLE};
use crate::remote_chat::protocol::ChatError;

const POLL_TIMEOUT: Duration = Duration::from_millis(250);
const MAX_RECORD_BYTES: usize = 16 * 1024;
const MAX_BATCH_RECORDS: usize = 16;
const BATCH_HEADER_BYTES: usize = 5;

/// Only the main WebView may read an existing authenticated native handle, one batch at a time.
#[tauri::command]
pub(crate) async fn remote_native_bulk_receive(
    app: AppHandle,
    window: Webview,
    id: String,
) -> Result<Response, String> {
    authorize(&window)?;
    uuid::Uuid::parse_str(&id).map_err(|_| UNAVAILABLE)?;
    let path = app
        .state::<State>()
        .0
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or(UNAVAILABLE)?;
    let _reader = path.bulk_reader.try_lock().map_err(|_| UNAVAILABLE)?;
    receive_batch(|| path.connection.receive_bulk())
        .await
        .map(Response::new)
        .map_err(|_| UNAVAILABLE.into())
}

async fn receive_batch<F, R>(mut receive: F) -> Result<Vec<u8>, ChatError>
where
    F: FnMut() -> R,
    R: Future<Output = Option<Vec<u8>>>,
{
    let first = match tokio::time::timeout(POLL_TIMEOUT, receive()).await {
        Ok(Some(record)) => record,
        Ok(None) => return Err(ChatError::Transport),
        Err(_) => return Ok(Vec::new()),
    };
    let mut batch =
        Vec::with_capacity(BATCH_HEADER_BYTES + MAX_BATCH_RECORDS * (4 + MAX_RECORD_BYTES));
    batch.extend_from_slice(b"RAN1\0");
    append_record(&mut batch, &first)?;
    // Never wait to fill a batch: deliver the first bytes immediately and drain only queued records.
    while usize::from(batch[4]) < MAX_BATCH_RECORDS {
        let Some(Some(record)) = receive().now_or_never() else {
            break;
        };
        append_record(&mut batch, &record)?;
    }
    Ok(batch)
}

fn append_record(batch: &mut Vec<u8>, record: &[u8]) -> Result<(), ChatError> {
    // The connectivity engine has already validated each encrypted RAB1 record.
    if record.is_empty() || record.len() > MAX_RECORD_BYTES {
        return Err(ChatError::InvalidFrame);
    }
    batch.extend_from_slice(&(record.len() as u32).to_be_bytes());
    batch.extend_from_slice(record);
    batch[4] += 1;
    Ok(())
}

#[cfg(test)]
#[path = "traversal_bulk_tests.rs"]
mod tests;
