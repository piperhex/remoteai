//! A paged viewer gets the same saved review for any edit size, independent of the current workspace.
use super::super::{
    error::{GuiError, Result},
    protocol::GuiResponse,
};
use rusqlite::{Connection, DatabaseName, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

// One transport page; reading continues until the complete saved file has been delivered.
const BODY_PAGE_BYTES: usize = 128 * 1024;
const PAGE: usize = 100;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Target {
    pub(in crate::codex_gui) thread_id: String,
    turn_id: String,
    file: Option<usize>,
    #[serde(default)]
    offset: usize,
    #[serde(default)]
    activity: bool,
}

impl Target {
    fn key(&self) -> [&str; 2] {
        [&self.thread_id, &self.turn_id]
    }

    fn ordinal(&self) -> &'static str {
        if self.activity {
            "activity_index"
        } else {
            "file_index"
        }
    }
}

fn summaries(db: &Connection, target: &Target) -> rusqlite::Result<Value> {
    let column = target.ordinal();
    let mut query = db.prepare(&format!(
        "SELECT summary FROM review_files WHERE thread=?1 AND turn=?2 AND {column}>=?3
         ORDER BY {column} LIMIT ?4"
    ))?;
    let mut rows = query.query(rusqlite::params![
        target.thread_id,
        target.turn_id,
        i64::try_from(target.offset).unwrap_or(i64::MAX),
        PAGE + 1
    ])?;
    let mut files = Vec::<Value>::new();
    while let Some(row) = rows.next()? {
        if files.len() == PAGE {
            return Ok(json!({"files":files,"next":target.offset + PAGE}));
        }
        let summary: String = row.get(0)?;
        files.push(serde_json::from_str(&summary).map_err(|_| rusqlite::Error::InvalidQuery)?);
    }
    Ok(json!({"files":files,"next":null}))
}

fn file_body(db: &Connection, target: &Target, file: usize) -> Result<Value> {
    let file = i64::try_from(file).map_err(|_| GuiError::InvalidRequest)?;
    let sql = format!(
        "SELECT f.id, f.patch_offset, f.byte_length, t.rowid FROM review_files f JOIN turns t USING(thread,turn)
         WHERE f.thread=?1 AND f.turn=?2 AND f.{}=?3", target.ordinal(),
    );
    let (id, patch_offset, size, turn): (i64, Option<usize>, usize, i64) = db
        .query_row(
            &sql,
            rusqlite::params![target.thread_id, target.turn_id, file],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|_| GuiError::FileRead)?
        .ok_or(GuiError::InvalidRequest)?;
    let left = size
        .checked_sub(target.offset)
        .ok_or(GuiError::InvalidRequest)?;
    let (table, column, row, start) = match patch_offset {
        Some(start) => ("turns", "diff", turn, start),
        None => ("review_bodies", "data", id, 0),
    };
    let blob = db
        .blob_open(DatabaseName::Main, table, column, row, true)
        .map_err(|_| GuiError::FileRead)?;
    let mut bytes = vec![0; left.min(BODY_PAGE_BYTES)];
    blob.read_at_exact(&mut bytes, start + target.offset)
        .map_err(|_| GuiError::FileRead)?;
    let text = match std::str::from_utf8(&bytes) {
        Ok(text) => text,
        Err(error) if error.error_len().is_none() && left > bytes.len() => {
            std::str::from_utf8(&bytes[..error.valid_up_to()]).map_err(|_| GuiError::FileRead)?
        }
        Err(_) => return Err(GuiError::InvalidRequest),
    };
    let end = target.offset + text.len();
    Ok(json!({"text":text, "next":(end < size).then_some(end)}))
}

fn saved(home: &Path, target: &Target) -> Result<Value> {
    let db = super::existing(home)
        .map_err(|_| GuiError::FileRead)?
        .ok_or(GuiError::FileRead)?;
    let tx = super::index::snapshot(&db, target.key())
        .map_err(|_| GuiError::FileRead)?
        .ok_or(GuiError::FileRead)?;
    let page = match target.file {
        Some(file) => file_body(&tx, target, file),
        None => summaries(&tx, target).map_err(|_| GuiError::FileRead),
    };
    tx.commit().map_err(|_| GuiError::FileRead)?;
    page
}

pub(crate) async fn read(home: PathBuf, target: Target) -> Result<GuiResponse> {
    super::super::protocol::id(&target.thread_id)?;
    super::super::protocol::id(&target.turn_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        saved(&home, &target).map(|data| GuiResponse { data })
    })
    .await
    .map_err(|_| GuiError::FileRead)?
}

#[cfg(test)]
mod tests;
