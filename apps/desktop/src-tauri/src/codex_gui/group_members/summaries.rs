//! Explicitly grouped chats must not wait for the recent-chat cursor to reach their date.
use super::{query, storage, GuiError, GuiResponse, Result, MAX_PREFERENCES};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_THREAD_ID_BYTES: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Query {
    thread_ids: Vec<String>,
    archived: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    id: String,
    name: String,
    preview: String,
    cwd: String,
    updated_at: i64,
}

impl Query {
    fn validate(&self) -> Result<()> {
        if self.thread_ids.len() > MAX_PREFERENCES
            || self
                .thread_ids
                .iter()
                .any(|id| id.is_empty() || id.len() > MAX_THREAD_ID_BYTES || id.contains('\0'))
        {
            return Err(GuiError::InvalidRequest);
        }
        Ok(())
    }
}

pub(in crate::codex_gui) async fn load(
    home: PathBuf,
    root: PathBuf,
    query: Query,
) -> Result<GuiResponse> {
    query.validate()?;
    tauri::async_runtime::spawn_blocking(move || {
        let summaries = read(&home, &root, &query).map_err(|_| GuiError::GroupMembers)?;
        Ok(GuiResponse {
            data: serde_json::to_value(summaries).map_err(|_| GuiError::GroupMembers)?,
        })
    })
    .await
    .map_err(|_| GuiError::GroupMembers)?
}

fn read(home: &Path, root: &Path, query: &Query) -> rusqlite::Result<Vec<Summary>> {
    let mut connection = storage::open(home)?;
    storage::functions(&connection, root)?;
    let transaction = connection.transaction()?;
    transaction.execute_batch("CREATE TEMP TABLE group_thread_ids (id TEXT PRIMARY KEY)")?;
    {
        let mut insert =
            transaction.prepare("INSERT OR IGNORE INTO group_thread_ids VALUES (?1)")?;
        for id in &query.thread_ids {
            insert.execute([id])?;
        }
    }
    storage::legacy_names(&transaction, home)?;
    let sql = format!(
        "{} SELECT c.id, c.title, c.cwd, c.updated / 1000 FROM group_thread_ids g
        CROSS JOIN conversations c WHERE c.id = g.id AND c.archived = ?1
        ORDER BY c.updated DESC, c.id DESC",
        query::members(&transaction)?
    );
    let result = transaction
        .prepare(&sql)?
        .query_map(params![query.archived], |row| {
            Ok(Summary {
                id: row.get(0)?,
                name: row.get(1)?,
                preview: String::new(),
                cwd: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    transaction.commit()?;
    Ok(result)
}

#[cfg(test)]
mod tests;
