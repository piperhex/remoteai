//! Bounded context and exact-turn detail reads. Never retry with a whole-thread read:
//! dropping a timed-out caller cannot cancel work already queued in the engine.
use super::error::{GuiError, Result};
use serde_json::{json, Value};
use std::{collections::HashSet, future::Future};

fn next_cursor(page: &Value, seen: &mut HashSet<String>) -> Result<Option<String>> {
    match &page["nextCursor"] {
        Value::Null => Ok(None),
        Value::String(cursor) if !cursor.is_empty() && seen.insert(cursor.clone()) => {
            Ok(Some(cursor.clone()))
        }
        _ => Err(GuiError::Rpc),
    }
}

pub(super) async fn recent<F, Fut>(id: &str, limit: usize, mut request: F) -> Result<Value>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    let mut data = request("thread/read", json!({"threadId":id,"includeTurns":false})).await?;
    if data["thread"]["id"] != id {
        return Err(GuiError::Rpc);
    }
    let mut page = request(
        "thread/turns/list",
        json!({"threadId":id,
        "limit":limit,"sortDirection":"desc","itemsView":"full"}),
    )
    .await?;
    let more = next_cursor(&page, &mut HashSet::new())?.is_some();
    let mut turns = page["data"]
        .as_array_mut()
        .map(std::mem::take)
        .ok_or(GuiError::Rpc)?;
    turns.reverse();
    data["thread"]["turns"] = json!(turns);
    data["thread"]["historyTruncated"] = json!(more);
    Ok(data)
}

/// Resume owns settings and lifecycle, not the visible history window.
pub(super) async fn resume<F, Fut>(data: &mut Value, mut request: F) -> Result<()>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    let id = data["thread"]["id"].as_str().ok_or(GuiError::Rpc)?;
    let mut page = request(
        "thread/turns/list",
        json!({"threadId":id,
        "limit":1,"sortDirection":"desc","itemsView":"notLoaded"}),
    )
    .await?;
    let turns = page["data"]
        .as_array_mut()
        .map(std::mem::take)
        .ok_or(GuiError::Rpc)?;
    data["thread"]["turns"] = json!(turns);
    Ok(())
}

/// Read every item in one requested turn, preserving order, payloads and timing.
pub(super) async fn turn<F, Fut>(id: &str, turn_id: &str, mut request: F) -> Result<Value>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    let mut items = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen = HashSet::new();
    let mut ids = HashSet::new();
    loop {
        let page = request(
            "thread/items/list",
            json!({"threadId":id,"turnId":turn_id,
            "limit":100,"sortDirection":"asc","cursor":cursor}),
        )
        .await?;
        for entry in page["data"].as_array().ok_or(GuiError::Rpc)? {
            if entry["turnId"] != turn_id {
                return Err(GuiError::Rpc);
            }
            let mut item = entry["item"].clone();
            let item_id = item["id"].as_str().ok_or(GuiError::Rpc)?;
            if !ids.insert(item_id.to_owned()) {
                return Err(GuiError::Rpc);
            }
            for key in ["startedAtMs", "completedAtMs"] {
                if !entry[key].is_null() {
                    item[key] = entry[key].clone();
                }
            }
            items.push(item);
        }
        cursor = next_cursor(&page, &mut seen)?;
        if cursor.is_none() {
            break;
        }
    }
    Ok(json!({"thread":{"id":id,"turns":[{"id":turn_id,"items":items}]}}))
}

/// Fetch one tool payload directly; older paginated engines can still read its turn.
pub(super) async fn item<F, Fut>(
    id: &str,
    turn_id: &str,
    item_id: &str,
    mut request: F,
) -> Result<Value>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    let response = request(
        "thread/items/read",
        json!({"threadId":id,
        "turnId":turn_id,"itemIds":[item_id]}),
    )
    .await;
    let page = match response {
        Err(GuiError::UnsupportedMethod) => return turn(id, turn_id, request).await,
        other => other?,
    };
    let entries = page["data"].as_array().ok_or(GuiError::Rpc)?;
    if entries.len() > 1 {
        return Err(GuiError::Rpc);
    }
    let mut items = Vec::new();
    for entry in entries {
        if entry["turnId"] != turn_id || entry["item"]["id"] != item_id {
            return Err(GuiError::Rpc);
        }
        let mut item = entry["item"].clone();
        for key in ["startedAtMs", "completedAtMs"] {
            if !entry[key].is_null() {
                item[key] = entry[key].clone();
            }
        }
        items.push(item);
    }
    Ok(json!({"thread":{"id":id,"turns":[{"id":turn_id,"items":items}]}}))
}

#[cfg(test)]
#[path = "history_access_tests.rs"]
mod tests;
