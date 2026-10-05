//! Raw binary IPC is restricted to an existing authenticated chat session and socket generation.
use super::protocol::{ChatError, Command};
use std::sync::{Arc, LazyLock};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Webview,
};
use tokio::sync::{oneshot, OwnedSemaphorePermit, Semaphore};

const HEADER_BYTES: usize = 5;
const MAX_RECORD_BYTES: usize = 16 * 1024;
const RECORD_HEADER_BYTES: usize = 72;
const TAG_BYTES: usize = 16;
const MAX_BATCH_RECORDS: usize = 16;
const IPC_QUEUE_BYTES: usize = 4 * 1024 * 1024;
static IPC_BUDGET: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(IPC_QUEUE_BYTES)));
const MAX_BATCH_BYTES: usize =
    HEADER_BYTES + MAX_BATCH_RECORDS * (4 + HEADER_BYTES + 128 + MAX_RECORD_BYTES);

#[cfg(test)]
#[path = "bulk_tests.rs"]
mod tests;

pub(super) struct BulkSend {
    pub client_id: String,
    pub generation: u64,
    pub session_id: String,
    pub frames: Vec<Vec<u8>>,
    pub completed: oneshot::Sender<Result<(), ChatError>>,
    pub _memory: OwnedSemaphorePermit,
}

pub(super) fn reserve_bytes(length: usize) -> Result<OwnedSemaphorePermit, ChatError> {
    if length == 0 || length > MAX_BATCH_BYTES {
        return Err(ChatError::InvalidFrame);
    }
    // Account for both the raw request and decoded frames. The command owns this reservation
    // even when its awaiting IPC future is cancelled before the runtime drains the queue.
    IPC_BUDGET
        .clone()
        .try_acquire_many_owned((length * 2) as u32)
        .map_err(|_| ChatError::Transport)
}

/// Validate the entire IPC batch before any frame can enter the authenticated socket queue.
pub(super) fn parse_frames(bytes: &[u8]) -> Result<(String, Vec<Vec<u8>>), ChatError> {
    if bytes.starts_with(b"CSF1") {
        return Ok((session_id(bytes)?, vec![bytes.to_vec()]));
    }
    if bytes.len() < HEADER_BYTES || bytes.len() > MAX_BATCH_BYTES || &bytes[..4] != b"CSFB" {
        return Err(ChatError::InvalidFrame);
    }
    let count = usize::from(bytes[4]);
    if count == 0 || count > MAX_BATCH_RECORDS {
        return Err(ChatError::InvalidFrame);
    }
    let mut remaining = &bytes[HEADER_BYTES..];
    let mut frames = Vec::with_capacity(count);
    let mut owner = None;
    for _ in 0..count {
        let length = remaining.get(..4).ok_or(ChatError::InvalidFrame)?;
        let length =
            u32::from_be_bytes(length.try_into().map_err(|_| ChatError::InvalidFrame)?) as usize;
        remaining = &remaining[4..];
        let frame = remaining.get(..length).ok_or(ChatError::InvalidFrame)?;
        let session = session_id(frame)?;
        if owner.as_ref().is_some_and(|owner| owner != &session) {
            return Err(ChatError::InvalidFrame);
        }
        owner = Some(session);
        frames.push(frame);
        remaining = &remaining[length..];
    }
    if !remaining.is_empty() {
        return Err(ChatError::InvalidFrame);
    }
    Ok((
        owner.ok_or(ChatError::InvalidFrame)?,
        frames.into_iter().map(<[u8]>::to_vec).collect(),
    ))
}

pub(super) fn session_id(bytes: &[u8]) -> Result<String, ChatError> {
    if bytes.len() <= HEADER_BYTES || &bytes[..4] != b"CSF1" {
        return Err(ChatError::InvalidFrame);
    }
    let length = usize::from(bytes[4]);
    let end = HEADER_BYTES + length;
    if length == 0 || length > 128 || end >= bytes.len() {
        return Err(ChatError::InvalidFrame);
    }
    let session =
        std::str::from_utf8(&bytes[HEADER_BYTES..end]).map_err(|_| ChatError::InvalidFrame)?;
    if !session
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
    {
        return Err(ChatError::InvalidFrame);
    }
    let record = &bytes[end..];
    if record.len() <= RECORD_HEADER_BYTES + TAG_BYTES
        || record.len() > MAX_RECORD_BYTES
        || &record[..8] != b"RAB1\x01\x01\x00\x48"
    {
        return Err(ChatError::InvalidFrame);
    }
    let encoded_length = u32::from_be_bytes(
        record[64..68]
            .try_into()
            .map_err(|_| ChatError::InvalidFrame)?,
    );
    if encoded_length as usize + RECORD_HEADER_BYTES + TAG_BYTES != record.len() {
        return Err(ChatError::InvalidFrame);
    }
    Ok(session.to_owned())
}

/// Acknowledges the socket write, keeping native queue memory visible to the frontend sender.
#[tauri::command]
pub(crate) async fn remote_chat_bulk_send(
    app: AppHandle,
    window: Webview,
    request: Request<'_>,
) -> Result<(), String> {
    let invalid = || "下载连接已中断，请重新连接后继续。".to_string();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(invalid());
    };
    let memory = reserve_bytes(bytes.len()).map_err(|_| invalid())?;
    let (session_id, frames) = parse_frames(bytes).map_err(|_| invalid())?;
    let client_id = request
        .headers()
        .get("x-file-bulk-client")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(invalid)?
        .to_owned();
    uuid::Uuid::parse_str(&client_id).map_err(|_| invalid())?;
    let generation = request
        .headers()
        .get("x-file-bulk-generation")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .ok_or_else(invalid)?;
    let (completed, result) = oneshot::channel();
    let command = BulkSend {
        client_id,
        generation,
        session_id,
        frames,
        completed,
        _memory: memory,
    };
    super::submit(app, window, Command::Bulk(command)).await?;
    result.await.map_err(|_| invalid())?.map_err(|_| invalid())
}
