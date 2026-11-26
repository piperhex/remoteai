use std::{collections::HashSet, fs, path::Path, time::Duration};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

use super::{identity::Identity, membership, SyncError, SECTION_KEY};

const DATABASE: &str = ".codex-global-state.sqlite";

struct Update {
    before: Option<String>,
    after: String,
    added: usize,
}

pub(super) fn sync(home: &Path, source: &Identity, target: &Identity) -> Result<usize, SyncError> {
    let path = home.join(DATABASE);
    if !path.try_exists()? {
        return Ok(0);
    }
    // Never create a database or migrate an unknown schema on behalf of Codex.
    let mut connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    connection.busy_timeout(Duration::from_secs(2))?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let Some(update) = prepare(&transaction, source, target)? else {
        return Ok(0);
    };
    backup(home, &target.scope, update.before.as_deref())?;
    transaction.execute(
        "INSERT INTO settings(scope, key, value) VALUES (?1, ?2, ?3) \
         ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value",
        params![target.scope, SECTION_KEY, update.after],
    )?;
    transaction.execute(
        "INSERT OR IGNORE INTO settings(scope, key, value) VALUES ('global', ?1, '{}')",
        params![target.scope],
    )?;
    transaction.commit()?;
    Ok(update.added)
}

fn prepare(
    connection: &Connection,
    source: &Identity,
    target: &Identity,
) -> Result<Option<Update>, SyncError> {
    let active_owner = read(connection, "global", "electron-renderer-content-owner")?
        .as_deref()
        .map(serde_json::from_str::<String>)
        .transpose()?;
    if active_owner.as_deref() != source.scope.strip_prefix(super::OWNER_PREFIX) {
        return Ok(None);
    }
    let Some(source_value) = read(connection, &source.scope, SECTION_KEY)? else {
        return Ok(None);
    };
    let source_value: Value = serde_json::from_str(&source_value)?;
    let Some(source_layout) = source_value.get(&source.account) else {
        return Ok(None);
    };
    let before = read(connection, &target.scope, SECTION_KEY)?;
    let mut target_value: Value = before
        .as_deref()
        .map(serde_json::from_str)
        .transpose()?
        .unwrap_or(json!({}));
    let target_map = target_value.as_object_mut().ok_or(SyncError::Schema)?;
    let target_layout = target_map
        .entry(&target.account)
        .or_insert_with(membership::empty_layout);
    let projects = eligible_project_ids(connection, target)?;
    let added = membership::merge(source_layout, target_layout, &projects)?;
    if added == 0 {
        return Ok(None);
    }
    Ok(Some(Update {
        before,
        after: target_value.to_string(),
        added,
    }))
}

fn read(connection: &Connection, scope: &str, key: &str) -> Result<Option<String>, SyncError> {
    Ok(connection
        .query_row(
            "SELECT value FROM settings WHERE scope = ?1 AND key = ?2",
            params![scope, key],
            |row| row.get(0),
        )
        .optional()?)
}

fn eligible_project_ids(
    connection: &Connection,
    target: &Identity,
) -> Result<HashSet<String>, SyncError> {
    let Some(raw) = read(connection, "global", "local-projects")? else {
        return Ok(HashSet::new());
    };
    let value: Value = serde_json::from_str(&raw)?;
    let mut projects: HashSet<String> = value
        .as_object()
        .ok_or(SyncError::Schema)?
        .keys()
        .cloned()
        .collect();
    if let Some(raw) = read(connection, &target.scope, "unified-sidebar-pinned-order-v1")? {
        let pinned: Vec<String> = serde_json::from_str(&raw)?;
        for key in pinned {
            if let Some(id) = key.strip_prefix("codex:project:") {
                projects.remove(id);
            }
        }
    }
    Ok(projects)
}

fn backup(home: &Path, scope: &str, value: Option<&str>) -> Result<(), SyncError> {
    let directory = home.join("sidebar-sync-backups");
    fs::create_dir_all(&directory)?;
    // NamedTempFile creates private files; persist without clobbering another backup.
    let mut file = tempfile::NamedTempFile::new_in(&directory)?;
    serde_json::to_writer_pretty(
        &mut file,
        &json!({
            "database": DATABASE, "scope": scope, "key": SECTION_KEY, "previousValue": value
        }),
    )?;
    file.as_file().sync_all()?;
    file.persist_noclobber(directory.join(format!("{}.json", uuid::Uuid::new_v4())))
        .map_err(|error| error.error)?;
    Ok(())
}
