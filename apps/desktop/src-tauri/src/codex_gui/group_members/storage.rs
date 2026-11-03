use super::Query;
use crate::codex_gui::platform::comparable_path;
use rusqlite::{functions::FunctionFlags, params, Connection, OpenFlags, Result};
use std::{
    fs::File,
    io::{BufRead, BufReader},
    path::Path,
    time::Duration,
};

pub(super) fn open(home: &Path) -> Result<Connection> {
    let connection = match crate::conversation_hub::latest_state_db(home) {
        Some(path) => Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?,
        None => {
            let connection = Connection::open_in_memory()?;
            connection.execute_batch(
                "CREATE TABLE threads (id TEXT, title TEXT, cwd TEXT,
                updated_at INTEGER, archived INTEGER)",
            )?;
            connection
        }
    };
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.execute_batch(
        "CREATE TEMP TABLE group_projects (path TEXT PRIMARY KEY, name TEXT);
        CREATE TEMP TABLE group_overrides (id TEXT PRIMARY KEY, path TEXT);
        CREATE TEMP TABLE group_names (id TEXT PRIMARY KEY, name TEXT);",
    )?;
    Ok(connection)
}

pub(super) fn functions(connection: &Connection, root: &Path) -> Result<()> {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    connection.create_scalar_function("group_lower", 1, flags, |context| {
        Ok(context.get::<String>(0)?.to_lowercase())
    })?;
    connection.create_scalar_function("group_basename", 1, flags, |context| {
        let path = context.get::<String>(0)?;
        Ok(path
            .rsplit(['/', '\\'])
            .find(|part| !part.is_empty())
            .unwrap_or(&path)
            .to_owned())
    })?;
    let root = comparable_path(&root.to_string_lossy());
    connection.create_scalar_function("group_cwd", 1, flags, move |context| {
        let path = context.get::<String>(0)?;
        let compared = comparable_path(&path);
        if compared == root
            || compared
                .strip_prefix(&root)
                .is_some_and(|suffix| suffix.starts_with('/'))
        {
            Ok(String::new())
        } else {
            Ok(path)
        }
    })
}

pub(super) fn preferences(connection: &Connection, query: &Query) -> Result<()> {
    let mut insert = connection.prepare("INSERT OR REPLACE INTO group_projects VALUES (?1, ?2)")?;
    for project in &query.projects {
        insert.execute(params![project.path, project.name])?;
    }
    let mut insert = connection.prepare("INSERT INTO group_overrides VALUES (?1, ?2)")?;
    for (id, path) in &query.project_overrides {
        insert.execute(params![id, path])?;
    }
    Ok(())
}

pub(super) fn legacy_names(connection: &Connection, home: &Path) -> Result<()> {
    // Old manual names live in the small append-only name index. Stream that metadata into a
    // temporary lookup table; never read rollouts or materialize the conversation list in memory.
    let file = match File::open(home.join("session_index.jsonl")) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(error))),
    };
    let mut insert = connection.prepare("INSERT OR REPLACE INTO group_names VALUES (?1, ?2)")?;
    for line in BufReader::new(file).lines() {
        let line =
            line.map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(id) = value.get("id").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let name = ["thread_name", "threadName", "title", "name"]
            .into_iter()
            .filter_map(|key| value.get(key).and_then(serde_json::Value::as_str))
            .map(str::trim)
            .find(|name| !name.is_empty());
        if let Some(name) = name {
            insert.execute(params![id, name])?;
        }
    }
    Ok(())
}
