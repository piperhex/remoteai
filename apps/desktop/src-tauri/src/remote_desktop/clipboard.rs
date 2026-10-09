//! Bounded, ordered clipboard transfers share the active desktop session and its input worker.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

pub(super) const CHUNK_BYTES: usize = 32 * 1024;
pub(super) const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_WIRE_BYTES: usize = MAX_BYTES * 2;
const TRANSFER_LEASE: Duration = Duration::from_secs(60);

#[derive(Debug, thiserror::Error)]
pub(super) enum ClipboardError {
    #[error("电脑未允许此剪贴板操作，请在电脑的设置中调整。")]
    Denied,
    #[error("剪贴板内容无效，请重新复制。")]
    Invalid,
    #[error("剪贴板内容过大，请分批复制（每次最多 64 MB）。")]
    Size,
    #[error("无法访问剪贴板，请重新复制后再试。")]
    Access,
    #[error("暂不支持复制文件夹，请先压缩后再复制。")]
    Directory,
    #[cfg(any(windows, target_os = "macos"))]
    #[error("未能复制所选内容，请确认远程窗口后重试。")]
    Copy,
}
pub(super) type ClipboardResult<T> = std::result::Result<T, ClipboardError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardMessage {
    pub request_id: u32,
    transfer_id: String,
    request: Request,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
enum Request {
    Read { shortcut: Option<Shortcut> },
    Begin { length: usize },
    Append { offset: usize, data: String },
    Commit { paste: bool },
    Chunk { offset: usize },
    Clear,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Shortcut {
    Copy,
    Cut,
}

#[derive(Default, Serialize)]
pub(crate) struct ReplyData {
    #[serde(skip_serializing_if = "Option::is_none")]
    length: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardReply {
    kind: &'static str,
    request_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<ReplyData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "format", rename_all = "camelCase")]
pub(crate) enum Content {
    Text { text: String },
    Image { data: String },
    Files { files: Vec<ClipboardFile> },
}
#[derive(Deserialize, Serialize)]
pub(crate) struct ClipboardFile {
    pub name: String,
    pub data: String,
}

pub(super) struct Transfer {
    id: String,
    bytes: Vec<u8>,
    expected: Option<usize>,
    touched: Instant,
}
impl Transfer {
    fn new(id: String, bytes: Vec<u8>, expected: Option<usize>) -> ClipboardResult<Self> {
        if bytes.len().max(expected.unwrap_or(0)) > MAX_WIRE_BYTES {
            return Err(ClipboardError::Size);
        }
        Ok(Self {
            id,
            bytes,
            expected,
            touched: Instant::now(),
        })
    }
    fn append(&mut self, offset: usize, data: &str) -> ClipboardResult<()> {
        if data.len() > CHUNK_BYTES * 2 {
            return Err(ClipboardError::Size);
        }
        let chunk = STANDARD.decode(data).map_err(|_| ClipboardError::Invalid)?;
        if offset != self.bytes.len()
            || chunk.is_empty()
            || chunk.len() > CHUNK_BYTES
            || self.bytes.len() + chunk.len() > self.expected.ok_or(ClipboardError::Invalid)?
        {
            return Err(ClipboardError::Invalid);
        }
        self.bytes.extend(chunk);
        Ok(())
    }
}

pub(super) fn handle(id: &str, message: ClipboardMessage) -> ClipboardReply {
    let request_id = message.request_id;
    let result = super::with_session(id, |session| Ok(apply(session, message)))
        .map_err(super::safe_error)
        .and_then(|result| result.map_err(|error| error.to_string()));
    let (result, error) = match result {
        Ok(reply) => (Some(reply), None),
        Err(error) => (None, Some(error)),
    };
    ClipboardReply {
        kind: "clipboard",
        request_id,
        result,
        error,
    }
}

fn apply(session: &mut super::Session, message: ClipboardMessage) -> ClipboardResult<ReplyData> {
    authorize(&session.permissions, &message.request)?;
    if message.transfer_id.is_empty() || message.transfer_id.len() > 100 {
        return Err(ClipboardError::Invalid);
    }
    let id = message.transfer_id;
    match message.request {
        Request::Read { shortcut } => {
            let content = super::clipboard_platform::read(session, shortcut)?;
            allow_content(&session.permissions, &content)?;
            let bytes = serde_json::to_vec(&content).map_err(|_| ClipboardError::Invalid)?;
            let length = bytes.len();
            session.clipboard = Some(Transfer::new(id, bytes, None)?);
            Ok(ReplyData {
                length: Some(length),
                data: None,
            })
        }
        Request::Begin { length } => {
            if length == 0 {
                return Err(ClipboardError::Invalid);
            }
            session.clipboard = Some(Transfer::new(id, Vec::new(), Some(length))?);
            Ok(ReplyData::default())
        }
        Request::Clear => {
            if session
                .clipboard
                .as_ref()
                .is_some_and(|transfer| transfer.id == id)
            {
                session.clipboard = None;
            }
            Ok(ReplyData::default())
        }
        request => continue_transfer(session, &id, request),
    }
}

fn allow_content(
    permissions: &super::permissions::Permissions,
    content: &Content,
) -> ClipboardResult<()> {
    if matches!(content, Content::Files { .. }) && !permissions.files {
        return Err(ClipboardError::Denied);
    }
    Ok(())
}

fn authorize(
    permissions: &super::permissions::Permissions,
    request: &Request,
) -> ClipboardResult<()> {
    let allowed = match request {
        Request::Read { shortcut } => {
            permissions.clipboard_read && (shortcut.is_none() || permissions.control)
        }
        Request::Chunk { .. } => permissions.clipboard_read,
        Request::Begin { .. } | Request::Append { .. } => permissions.clipboard_write,
        Request::Commit { paste } => permissions.clipboard_write && (!paste || permissions.control),
        Request::Clear => true,
    };
    if allowed {
        Ok(())
    } else {
        Err(ClipboardError::Denied)
    }
}

fn continue_transfer(
    session: &mut super::Session,
    id: &str,
    request: Request,
) -> ClipboardResult<ReplyData> {
    let transfer = session
        .clipboard
        .as_mut()
        .filter(|transfer| transfer.id == id && transfer.touched.elapsed() < TRANSFER_LEASE)
        .ok_or(ClipboardError::Invalid)?;
    transfer.touched = Instant::now();
    match request {
        Request::Append { offset, data } => {
            transfer.append(offset, &data)?;
            Ok(ReplyData::default())
        }
        Request::Chunk { offset } => {
            if transfer.expected.is_some() || offset >= transfer.bytes.len() {
                return Err(ClipboardError::Invalid);
            }
            let end = (offset + CHUNK_BYTES).min(transfer.bytes.len());
            Ok(ReplyData {
                data: Some(STANDARD.encode(&transfer.bytes[offset..end])),
                length: None,
            })
        }
        Request::Commit { paste } => {
            if transfer.expected != Some(transfer.bytes.len()) {
                return Err(ClipboardError::Invalid);
            }
            let content =
                serde_json::from_slice(&transfer.bytes).map_err(|_| ClipboardError::Invalid)?;
            session.clipboard = None;
            allow_content(&session.permissions, &content)?;
            super::clipboard_platform::write(session, content, paste)?;
            Ok(ReplyData::default())
        }
        _ => Err(ClipboardError::Invalid),
    }
}

#[tauri::command]
pub(crate) async fn remote_desktop_clipboard(
    id: String,
    message: ClipboardMessage,
) -> ClipboardReply {
    let request_id = message.request_id;
    tauri::async_runtime::spawn_blocking(move || handle(&id, message))
        .await
        .unwrap_or_else(|_| ClipboardReply {
            kind: "clipboard",
            request_id,
            result: None,
            error: Some(ClipboardError::Access.to_string()),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn enforces_direction_control_and_file_permissions() {
        let policy = super::super::permissions::Permissions {
            control: false,
            clipboard_write: false,
            files: false,
            ..Default::default()
        };
        assert!(authorize(&policy, &Request::Read { shortcut: None }).is_ok());
        assert!(authorize(
            &policy,
            &Request::Read {
                shortcut: Some(Shortcut::Copy)
            }
        )
        .is_err());
        assert!(authorize(&policy, &Request::Begin { length: 5 }).is_err());
        assert!(authorize(&policy, &Request::Commit { paste: true }).is_err());
        assert!(allow_content(&policy, &Content::Files { files: Vec::new() }).is_err());
        assert!(allow_content(
            &policy,
            &Content::Text {
                text: "test".into()
            }
        )
        .is_ok());
    }
    #[test]
    fn rejects_oversize_reordered_and_excess_chunks() {
        assert!(Transfer::new("test".into(), vec![], Some(MAX_WIRE_BYTES + 1)).is_err());
        let mut transfer = Transfer::new("test".into(), vec![], Some(3)).unwrap();
        assert!(transfer.append(1, "YQ==").is_err());
        assert!(transfer.append(0, "YWJjZA==").is_err());
        transfer.append(0, "YWJj").unwrap();
        assert_eq!(transfer.bytes, b"abc");
        assert!(transfer.append(3, "YQ==").is_err());
        assert!(transfer.append(3, "!!!").is_err());
    }
}
