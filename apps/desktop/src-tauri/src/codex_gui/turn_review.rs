//! Durable execution-host evidence. Workspace status never enters this journal or the undo path.
use super::protocol::GuiEvent;
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde_json::{json, Value};
use std::path::Path;

const DATABASE: &str = "turn-reviews.sqlite";
pub(super) mod archive;
#[path = "turn_review_net.rs"]
mod net;

fn open(home: &Path) -> Result<Connection> {
    let db = Connection::open(home.join(DATABASE))?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS turns (
        thread TEXT NOT NULL, turn TEXT NOT NULL, cwd TEXT, diff TEXT,
        started INTEGER NOT NULL DEFAULT 0, finished INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(thread,turn));
        CREATE TABLE IF NOT EXISTS edits (
        thread TEXT NOT NULL, turn TEXT NOT NULL, item TEXT NOT NULL, body TEXT NOT NULL,
        UNIQUE(thread,turn,item));
        CREATE TABLE IF NOT EXISTS observations(thread TEXT, turn TEXT, body TEXT NOT NULL,
        PRIMARY KEY(thread,turn));
        CREATE TABLE IF NOT EXISTS gaps(thread TEXT, turn TEXT,
        PRIMARY KEY(thread,turn));",
    )?;
    Ok(db)
}

pub(super) fn observes(event: &GuiEvent) -> bool {
    event.id.is_none()
        && (matches!(
            event.method.as_str(),
            "turn/started" | "turn/completed" | "turn/diff/updated"
        ) || (matches!(event.method.as_str(), "item/started" | "item/completed")
            && event.params["item"]["type"] == "fileChange"))
}

pub(super) fn bind_cwd(home: &Path, thread: &str, turn: &str, cwd: &str) -> Result<bool> {
    let db = open(home)?;
    db.query_row(
        "INSERT INTO turns(thread,turn,cwd) VALUES (?1,?2,?3)
        ON CONFLICT(thread,turn) DO UPDATE SET cwd=excluded.cwd RETURNING finished",
        params![thread, turn, cwd],
        |row| row.get(0),
    )
}

pub(super) fn record(home: &Path, event: &GuiEvent, cwd: Option<String>) -> Result<()> {
    let fields = &event.params;
    let Some(thread) = fields["threadId"].as_str() else {
        return Ok(());
    };
    let Some(turn) = fields["turnId"]
        .as_str()
        .or_else(|| fields["turn"]["id"].as_str())
    else {
        return Ok(());
    };
    let mut db = open(home)?;
    let tx = db.transaction()?;
    let started = event.method == "turn/started";
    let finished = event.method == "turn/completed";
    let diff = fields["diff"]
        .as_str()
        .or_else(|| fields["turn"]["diff"].as_str());
    tx.execute(
        "INSERT INTO turns (thread,turn,cwd,diff,started,finished) VALUES (?1,?2,?3,?4,?5,?6)
        ON CONFLICT(thread,turn) DO UPDATE SET cwd=coalesce(turns.cwd,excluded.cwd),
        diff=coalesce(excluded.diff,turns.diff), started=max(turns.started,excluded.started),
        finished=max(turns.finished,excluded.finished)",
        params![thread, turn, cwd, diff, started, finished],
    )?;
    let items = fields["turn"]["items"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(fields.get("item"));
    for item in items.filter(|item| item["type"] == "fileChange" && item["changes"].is_array()) {
        if let Some(id) = item["id"].as_str() {
            if matches!(event.method.as_str(), "item/started" | "item/completed") {
                tx.execute(
                    "UPDATE turns SET diff=NULL WHERE thread=?1 AND turn=?2
                    AND NOT EXISTS (SELECT 1 FROM edits WHERE thread=?1 AND turn=?2 AND item=?3)",
                    params![thread, turn, id],
                )?;
            }
            let body = json!({"id":id, "type":"fileChange", "changes":item["changes"], "status":item["status"]});
            tx.execute(
                "INSERT INTO edits(thread,turn,item,body) VALUES (?1,?2,?3,?4)
                ON CONFLICT(thread,turn,item) DO UPDATE SET body=excluded.body
                WHERE json_extract(excluded.body,'$.status') != 'inProgress'
                OR coalesce(json_extract(edits.body,'$.status'),'inProgress') = 'inProgress'",
                params![thread, turn, id, body.to_string()],
            )?;
        }
    }
    if fields["reviewIncomplete"] == true || fields["turn"]["reviewIncomplete"] == true {
        tx.execute(
            "INSERT OR IGNORE INTO gaps VALUES (?1,?2)",
            params![thread, turn],
        )?;
    }
    if let Some(value) = fields["turn"].get("workspaceObservation") {
        tx.execute(
            "INSERT OR REPLACE INTO observations VALUES (?1,?2,?3)",
            params![thread, turn, value.to_string()],
        )?;
    }
    tx.commit()
}

fn restore_turn(db: &Connection, thread: &str, turn: &mut Value) -> Result<()> {
    let Some(id) = turn["id"].as_str() else {
        return Ok(());
    };
    let record = db
        .query_row(
            "SELECT cwd,diff,started,finished,EXISTS(SELECT 1 FROM gaps WHERE thread=?1 AND turn=?2)
            FROM turns WHERE thread=?1 AND turn=?2",
            params![thread, id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, bool>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((cwd, diff, started, finished, gap)) = record else {
        return Ok(());
    };
    let mut query =
        db.prepare("SELECT body FROM edits WHERE thread=?1 AND turn=?2 ORDER BY rowid")?;
    let mut edits = Vec::new();
    for body in query.query_map(params![thread, id], |row| row.get::<_, String>(0))? {
        edits.push(
            serde_json::from_str::<Value>(&body?).map_err(|_| rusqlite::Error::InvalidQuery)?,
        );
    }
    let observation: Option<String> = db
        .query_row(
            "SELECT body FROM observations WHERE thread=?1 AND turn=?2",
            params![thread, id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(body) = observation {
        turn["workspaceObservation"] =
            serde_json::from_str(&body).map_err(|_| rusqlite::Error::InvalidQuery)?;
    }
    let diff =
        diff.or_else(|| (started && finished && !gap && net::cancelled(&edits)).then(String::new));
    turn["reviewEdits"] = Value::Array(edits);
    turn["reviewCwd"] = json!(cwd);
    turn["reviewIncomplete"] =
        json!(gap || !started || (!finished && turn["status"] != "inProgress"));
    turn["diff"] = json!(diff);
    Ok(())
}

pub(super) fn restore(home: &Path, thread: &mut Value) -> Result<()> {
    let Some(id) = thread["id"].as_str().map(str::to_owned) else {
        return Ok(());
    };
    let Some(turns) = thread["turns"].as_array_mut() else {
        return Ok(());
    };
    if turns.is_empty()
        || !home
            .join(DATABASE)
            .try_exists()
            .map_err(|_| rusqlite::Error::InvalidPath(home.into()))?
    {
        return Ok(());
    }
    let db = open(home)?;
    for turn in turns {
        restore_turn(&db, &id, turn)?;
    }
    Ok(())
}

pub(super) fn restore_page(home: &Path, thread: &mut Value) -> Result<()> {
    restore(home, thread)?;
    let Some(thread_id) = thread["id"].as_str().map(str::to_owned) else {
        return Ok(());
    };
    for turn in thread["turns"].as_array_mut().into_iter().flatten() {
        if turn["reviewEdits"].is_array() {
            archive::project(turn, &thread_id);
        }
    }
    Ok(())
}
