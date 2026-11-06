//! Durable GUI outbox. SQLite serializes complete snapshots and rejects stale writers.
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};
use tauri::{AppHandle, Manager};

const MAX_SNAPSHOT_BYTES: usize = 256 * 1024 * 1024;
const MAX_THREADS: usize = 1000;
const MAX_MESSAGES: usize = 100;

#[derive(Debug, thiserror::Error)]
pub(super) enum QueueError {
    #[error("待发送消息未能保存，请检查可用空间后重试。")]
    Storage,
    #[error("待发送消息已在另一窗口更新，请重新打开聊天。")]
    Conflict,
    #[error("待发送消息过多或内容无效，请减少附件后重试。")]
    Invalid,
}
type Result<T> = std::result::Result<T, QueueError>;

#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct QueueSnapshot {
    revision: u64,
    threads: BTreeMap<String, Vec<QueueMessage>>,
}

impl QueueSnapshot {
    fn has_pending(&self, thread_ids: &[String]) -> bool {
        thread_ids.iter().any(|id| {
            self.threads
                .get(id)
                .is_some_and(|messages| !messages.is_empty())
        })
    }
}

/// Check the durable GUI outbox as well as the engine queue before deleting a tree.
pub(super) async fn has_pending(app: AppHandle, thread_ids: &[String]) -> Result<bool> {
    Ok(access(app, None).await?.has_pending(thread_ids))
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueueMessage {
    id: String,
    /// Preserve the originating client's receipt when the durable queue is restored.
    #[serde(skip_serializing_if = "Option::is_none")]
    client_id: Option<String>,
    text: String,
    images: Vec<String>,
    skills: Vec<Skill>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attachments: Option<Vec<Attachment>>,
    model: String,
    effort: String,
    access: AccessMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    busy: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    needs_review: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transfer_mode: Option<TransferMode>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum AccessMode {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum TransferMode {
    Direct,
    Relay,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Skill {
    name: String,
    path: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Attachment {
    kind: AttachmentKind,
    name: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum AttachmentKind {
    Coze,
    File,
    Folder,
    Plugin,
    Conversation,
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

fn encode(snapshot: &QueueSnapshot) -> Result<String> {
    if snapshot.threads.len() > MAX_THREADS
        || snapshot.threads.iter().any(|(id, messages)| {
            !identifier(id)
                || messages.len() > MAX_MESSAGES
                || messages.iter().any(|message| {
                    !identifier(&message.id)
                        || message.images.len() > 12
                        || message.skills.len() > 100
                        || message
                            .attachments
                            .as_ref()
                            .is_some_and(|files| files.len() > 32)
                })
        })
    {
        return Err(QueueError::Invalid);
    }
    let json = serde_json::to_string(snapshot).map_err(|_| QueueError::Invalid)?;
    if json.len() > MAX_SNAPSHOT_BYTES {
        return Err(QueueError::Invalid);
    }
    Ok(json)
}

fn connect(root: &Path) -> Result<Connection> {
    std::fs::create_dir_all(root).map_err(|_| QueueError::Storage)?;
    let connection =
        Connection::open(root.join("codex-gui-outbox.db")).map_err(|_| QueueError::Storage)?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| QueueError::Storage)?;
    connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);")
        .map_err(|_| QueueError::Storage)?;
    Ok(connection)
}

fn read(connection: &Connection) -> Result<QueueSnapshot> {
    let value: Option<String> = connection
        .query_row("SELECT payload FROM outbox WHERE id=1", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|_| QueueError::Storage)?;
    let Some(value) = value else {
        return Ok(QueueSnapshot::default());
    };
    if value.len() > MAX_SNAPSHOT_BYTES {
        return Err(QueueError::Invalid);
    }
    serde_json::from_str(&value).map_err(|_| QueueError::Storage)
}

fn save(connection: &mut Connection, mut snapshot: QueueSnapshot) -> Result<QueueSnapshot> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| QueueError::Storage)?;
    if read(&transaction)?.revision != snapshot.revision {
        return Err(QueueError::Conflict);
    }
    snapshot.revision = snapshot
        .revision
        .checked_add(1)
        .ok_or(QueueError::Invalid)?;
    let json = encode(&snapshot)?;
    transaction
        .execute(
            "INSERT INTO outbox(id,payload) VALUES(1,?1)
        ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            [json],
        )
        .map_err(|_| QueueError::Storage)?;
    transaction.commit().map_err(|_| QueueError::Storage)?;
    Ok(snapshot)
}

async fn access(app: AppHandle, snapshot: Option<QueueSnapshot>) -> Result<QueueSnapshot> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app.path().app_data_dir().map_err(|_| QueueError::Storage)?;
        let mut connection = connect(&root)?;
        match snapshot {
            Some(snapshot) => save(&mut connection, snapshot),
            None => read(&connection),
        }
    })
    .await
    .map_err(|_| QueueError::Storage)?
}

#[tauri::command]
pub(crate) async fn codex_gui_queue_read(
    app: AppHandle,
) -> std::result::Result<QueueSnapshot, String> {
    access(app, None).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_queue_save(
    app: AppHandle,
    snapshot: QueueSnapshot,
) -> std::result::Result<QueueSnapshot, String> {
    access(app, Some(snapshot))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_remote_client_receipts_after_reopening() {
        for transfer_mode in ["direct", "relay"] {
            let root = tempfile::tempdir().unwrap();
            let mut payload = serde_json::json!({"revision":0,"threads":{
                "thread":[{"id":"message","clientId":"local-phone-request","text":"hello",
                    "images":[],"skills":[],"model":"model","effort":"high",
                    "access":"read-only","transferMode":transfer_mode}]
            }});
            let snapshot: QueueSnapshot = serde_json::from_value(payload.clone()).unwrap();
            let mut connection = connect(root.path()).unwrap();
            let saved = save(&mut connection, snapshot).unwrap();
            payload["revision"] = serde_json::json!(1);
            assert_eq!(serde_json::to_value(saved).unwrap(), payload);
            drop(connection);

            let connection = connect(root.path()).unwrap();
            let restored = read(&connection).unwrap();
            assert_eq!(serde_json::to_value(restored).unwrap(), payload);
        }
    }

    #[test]
    fn persists_across_connections_and_rejects_stale_snapshots() {
        let root = std::env::temp_dir().join(format!("csw-outbox-{}", uuid::Uuid::new_v4()));
        let mut connection = connect(&root).unwrap();
        let snapshot: QueueSnapshot =
            serde_json::from_value(serde_json::json!({"revision":0,"threads":{
                "thread":[{"id":"message","text":"hello","images":[],"skills":[],
                    "attachments":[{"kind":"coze","name":"库存",
                        "path":"coze://f321c884-a198-4244-ad4f-53762b3d2aba"}],
                    "model":"model","effort":"high","access":"read-only","busy":true}]
            }}))
            .unwrap();
        save(&mut connection, snapshot).unwrap();
        assert!(matches!(
            save(&mut connection, QueueSnapshot::default()),
            Err(QueueError::Conflict)
        ));
        drop(connection);
        let connection = connect(&root).unwrap();
        let restored = read(&connection).unwrap();
        assert_eq!(restored.revision, 1);
        assert_eq!(restored.threads["thread"][0].busy, Some(true));
        let saved = serde_json::to_value(&restored).unwrap();
        assert_eq!(
            saved["threads"]["thread"][0]["attachments"][0]["kind"],
            "coze"
        );
        assert!(restored.has_pending(&["parent".into(), "thread".into()]));
        assert!(!restored.has_pending(&["unrelated".into()]));
        assert!(!QueueSnapshot::default().has_pending(&["thread".into()]));
        drop(connection);
        std::fs::remove_dir_all(root).unwrap();
    }
}
