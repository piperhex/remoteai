//! Persist the paged history projection and per-file metadata on the execution host.
use super::files::{patch_files, File};
use rusqlite::{
    params, Connection, OptionalExtension, Result, Statement, Transaction, TransactionBehavior,
};
use serde_json::{json, Value};
use std::collections::HashSet;

pub(super) fn init(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS review_pages (
            thread TEXT NOT NULL, turn TEXT NOT NULL, fields TEXT NOT NULL, item_ids TEXT NOT NULL,
            PRIMARY KEY(thread,turn));
        CREATE TABLE IF NOT EXISTS review_files (
            id INTEGER PRIMARY KEY, thread TEXT NOT NULL, turn TEXT NOT NULL,
            file_index INTEGER, activity_index INTEGER, summary TEXT NOT NULL,
            patch_offset INTEGER, byte_length INTEGER NOT NULL,
            UNIQUE(thread,turn,file_index), UNIQUE(thread,turn,activity_index),
            FOREIGN KEY(thread,turn) REFERENCES review_pages ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED);
        CREATE TABLE IF NOT EXISTS review_bodies (
            id INTEGER PRIMARY KEY REFERENCES review_files ON DELETE CASCADE, data BLOB NOT NULL);",
    )
}

/// Net files reference byte ranges in the original patch. Tool edits are JSON-escaped in the journal,
/// so keep their decoded file bodies individually addressable by both the result and activity views.
fn index_files(db: &Connection, key: [&str; 2], turn: &Value) -> Result<()> {
    let mut insert = db.prepare(
        "INSERT INTO review_files(thread,turn,file_index,activity_index,summary,patch_offset,byte_length)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
    )?;
    let diff = turn["diff"].as_str();
    if let Some(patch) = diff.filter(|s| !s.is_empty()) {
        index_patch(&mut insert, key, patch)?;
    }
    let mut store = db.prepare("INSERT INTO review_bodies(id,data) VALUES (?1,?2)")?;
    let mut completed = 0usize..;
    for (activity, (item, change)) in edits(turn).enumerate() {
        let file_index = if diff.is_none() && item["status"] == "completed" {
            completed.next()
        } else {
            None
        };
        let text = change["diff"].as_str().unwrap_or_default();
        let file = File {
            meta: json!({"path":change["path"],"kind":change["kind"],"item":item["id"]}),
            text,
        };
        let row = insert.insert(params![
            key[0],
            key[1],
            file_index,
            activity,
            file.summary().to_string(),
            None::<usize>,
            text.len()
        ])?;
        store.execute(params![row, text.as_bytes()])?;
    }
    Ok(())
}

fn index_patch(insert: &mut Statement, [thread, id]: [&str; 2], patch: &str) -> Result<()> {
    let mut offset = 0;
    for (index, file) in patch_files(patch).enumerate() {
        let size = file.text.len();
        let summary = file.summary().to_string();
        insert.execute(params![
            thread,
            id,
            index,
            None::<usize>,
            summary,
            offset,
            size
        ])?;
        offset += size;
    }
    Ok(())
}

pub(super) fn build(tx: &Transaction, key: [&str; 2]) -> Result<()> {
    let [thread, id] = key;
    let mut turn = json!({"id":id,"status":"completed"});
    super::restore_turn(tx, thread, &mut turn)?;
    index_files(tx, key, &turn)?;
    let recorded = project(&mut turn);
    let fields = turn.as_object_mut().ok_or(rusqlite::Error::InvalidQuery)?;
    for field in ["id", "status", "reviewCwd"] {
        fields.remove(field);
    }
    tx.execute(
        "INSERT INTO review_pages(thread,turn,fields,item_ids) VALUES (?1,?2,?3,?4)",
        params![thread, id, turn.to_string(), json!(recorded).to_string()],
    )?;
    Ok(())
}

fn indexed(db: &Connection, key: [&str; 2]) -> Result<Option<bool>> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM review_pages WHERE thread=?1 AND turn=?2)
         FROM turns WHERE thread=?1 AND turn=?2",
        key,
        |row| row.get(0),
    )
    .optional()
}

/// Old journals are indexed once per requested turn. Recheck under a write lock if two readers
/// encounter the same old turn, and use a single snapshot for metadata and its referenced bytes.
pub(super) fn snapshot<'a>(db: &'a Connection, key: [&str; 2]) -> Result<Option<Transaction<'a>>> {
    let tx = db.unchecked_transaction()?;
    match indexed(&tx, key)? {
        Some(true) => return Ok(Some(tx)),
        None => return Ok(None),
        Some(false) => drop(tx),
    }
    let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate)?;
    match indexed(&tx, key)? {
        Some(true) => (),
        None => return Ok(None),
        Some(false) => build(&tx, key)?,
    }
    Ok(Some(tx))
}

pub(super) fn restore_page(db: &Connection, thread: &str, turn: &mut Value) -> Result<()> {
    if turn["status"] == "inProgress" {
        return super::restore_turn(db, thread, turn);
    }
    let Some(id) = turn["id"].as_str() else {
        return Ok(());
    };
    let key = [thread, id];
    let Some(tx) = snapshot(db, key)? else {
        return Ok(());
    };
    let (fields, ids, cwd): (String, String, Option<String>) = tx.query_row(
        "SELECT fields,item_ids,cwd FROM review_pages JOIN turns USING(thread,turn)
         WHERE thread=?1 AND turn=?2",
        key,
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    tx.commit()?;
    let fields: serde_json::Map<String, Value> =
        serde_json::from_str(&fields).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let ids = serde_json::from_str(&ids).map_err(|_| rusqlite::Error::InvalidQuery)?;
    for (key, value) in fields {
        turn[key] = value;
    }
    turn["reviewCwd"] = json!(cwd);
    omit_bodies(turn, &ids, thread);
    Ok(())
}

fn edits(turn: &Value) -> impl Iterator<Item = (&Value, &Value)> {
    turn["reviewEdits"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|item| {
            item["changes"]
                .as_array()
                .into_iter()
                .flatten()
                .map(move |change| (item, change))
        })
}

pub(super) fn project(turn: &mut Value) -> HashSet<String> {
    let diff = turn["diff"].as_str();
    if turn["status"] == "inProgress"
        || (diff.is_none_or(|text| text.trim().is_empty()) && edits(turn).next().is_none())
    {
        return HashSet::new();
    }
    let result = match (turn["reviewIncomplete"] == true, diff) {
        (true, _) => "incomplete",
        (_, Some(text)) if text.trim().is_empty() => "empty",
        (_, Some(_)) => "net",
        _ if edits(turn).any(|(item, _)| item["status"] == "completed") => "tools",
        _ => "incomplete",
    };
    let recorded: HashSet<String> = edits(turn)
        .filter_map(|(item, _)| item["id"].as_str().map(str::to_owned))
        .collect();
    turn["reviewHasEdits"] = json!(
        matches!(result, "net" | "tools")
            && edits(turn).any(|(item, _)| item["status"] == "completed")
    );
    turn["reviewDeferred"] = json!(result);
    turn["diff"] = Value::Null;
    turn["reviewEdits"] = json!([]);
    recorded
}

fn omit_bodies(turn: &mut Value, recorded: &HashSet<String>, thread: &str) {
    let turn_id = turn["id"].clone();
    for item in turn
        .get_mut("items")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        omit_edit_body(item, recorded, thread, &turn_id);
        for output in item
            .get_mut("processOutputs")
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            omit_edit_body(output, recorded, thread, &turn_id);
        }
    }
}

fn omit_edit_body(item: &mut Value, recorded: &HashSet<String>, thread: &str, turn_id: &Value) {
    if item["type"] == "fileChange" && item["id"].as_str().is_some_and(|id| recorded.contains(id)) {
        item["detailsRef"] = json!({"threadId":thread,"turnId":turn_id,"itemId":item["id"]});
        for change in item["changes"].as_array_mut().into_iter().flatten() {
            change["diff"] = json!("");
        }
    }
}
