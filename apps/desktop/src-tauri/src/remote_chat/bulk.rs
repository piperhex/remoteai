//! Raw binary IPC is restricted to an existing authenticated chat session and socket generation.
use super::protocol::{ChatError, Command};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Webview,
};
use tokio::sync::oneshot;

const HEADER_BYTES: usize = 5;
const MAX_RECORD_BYTES: usize = 16 * 1024;
const RECORD_HEADER_BYTES: usize = 72;
const TAG_BYTES: usize = 16;

pub(super) struct BulkSend {
    pub client_id: String,
    pub generation: u64,
    pub session_id: String,
    pub bytes: Vec<u8>,
    pub completed: oneshot::Sender<Result<(), ChatError>>,
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
    let session_id = session_id(bytes).map_err(|_| invalid())?;
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
        bytes: bytes.clone(),
        completed,
    };
    super::submit(app, window, Command::Bulk(command)).await?;
    result.await.map_err(|_| invalid())?.map_err(|_| invalid())
}
