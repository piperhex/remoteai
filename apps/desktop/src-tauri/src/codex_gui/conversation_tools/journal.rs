//! Persist the intent before a mutation. Unknown outcomes are never automatically replayed.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

use super::{protocol::Mutation, Error, Result};

#[derive(Default)]
pub(super) struct Journal(Mutex<()>);

#[derive(Deserialize, Serialize)]
struct Record {
    fingerprint: String,
    receipt: Value,
}

pub(super) struct Entry {
    path: PathBuf,
    record: Record,
}

pub(super) enum Claim {
    New(Entry),
    Existing(Value),
}

impl Journal {
    pub async fn claim(&self, home: &Path, mutation: &Mutation) -> Result<Claim> {
        let _guard = self.0.lock().await;
        let bytes = serde_json::to_vec(mutation)?;
        let fingerprint = format!("{:x}", Sha256::digest(bytes));
        let key = format!("{:x}", Sha256::digest(mutation.request_id().as_bytes()));
        let path = home
            .join("conversation-tool-requests")
            .join(format!("{key}.json"));
        let request_id = mutation.request_id().to_owned();
        tauri::async_runtime::spawn_blocking(move || claim(path, fingerprint, request_id))
            .await
            .map_err(|_| Error::Storage)?
    }
}

fn claim(path: PathBuf, fingerprint: String, request_id: String) -> Result<Claim> {
    match std::fs::read(&path) {
        Ok(bytes) => {
            let record: Record = serde_json::from_slice(&bytes).map_err(|_| Error::Storage)?;
            if record.fingerprint != fingerprint {
                return Err(Error::RequestConflict);
            }
            return Ok(Claim::Existing(record.receipt));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(Error::Storage),
    }
    let entry = Entry {
        path,
        record: Record {
            fingerprint,
            receipt: json!({"requestId": request_id, "status": "unknown",
            "note": "请求可能仍在处理中。请查询对话；重试时保持相同的请求标识和内容。"}),
        },
    };
    write(&entry.path, &entry.record)?;
    Ok(Claim::New(entry))
}

fn write(path: &Path, record: &Record) -> Result<()> {
    let directory = path.parent().ok_or(Error::Storage)?;
    std::fs::create_dir_all(directory).map_err(|_| Error::Storage)?;
    crate::storage::write_json_atomic(path, &serde_json::to_value(record)?)
        .map_err(|_| Error::Storage)
}

impl Entry {
    pub async fn update(&mut self, receipt: Value) -> Result<Value> {
        let mut receipt = receipt;
        receipt["requestId"] = self.record.receipt["requestId"].clone();
        self.record.receipt = receipt;
        let path = self.path.clone();
        let record = Record {
            fingerprint: self.record.fingerprint.clone(),
            receipt: self.record.receipt.clone(),
        };
        tauri::async_runtime::spawn_blocking(move || write(&path, &record))
            .await
            .map_err(|_| Error::Storage)??;
        Ok(self.record.receipt.clone())
    }

    pub fn receipt(&self) -> Value {
        self.record.receipt.clone()
    }
}
