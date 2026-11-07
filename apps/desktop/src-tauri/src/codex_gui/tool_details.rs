//! Keep execution payloads in the host until a viewer opens one exact item.
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    connection::Connection,
    error::{GuiError, Result},
    protocol::{self, GuiResponse},
};

mod command_preview;

#[cfg(test)]
#[path = "tool_details_tests.rs"]
mod tests;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Target {
    thread_id: String,
    turn_id: String,
    item_id: String,
}

fn deferred(item: &Value) -> bool {
    matches!(
        item["type"].as_str(),
        Some("commandExecution" | "mcpToolCall" | "dynamicToolCall" | "functionCallOutput")
    )
}

fn summarize_item(item: &mut Value, thread_id: &str, turn_id: &str) {
    if !deferred(item) || item["detailsRef"].is_object() {
        return;
    }
    let reference = json!({"threadId": thread_id, "turnId": turn_id, "itemId": item["id"]});
    let action = action_preview(item);
    let preview = command_preview::preview(item["command"].as_str().unwrap_or_default());
    if let Some(fields) = item.as_object_mut() {
        fields.retain(|key, _| {
            matches!(
                key.as_str(),
                "id" | "type" | "status" | "exitCode" | "durationMs" | "tool" | "server" | "name"
            )
        });
        fields.insert("detailsRef".into(), reference);
        if let Some(action) = action {
            fields.insert("commandActions".into(), json!([action]));
        }
        if !preview.is_empty() {
            fields.insert("commandPreview".into(), json!(preview));
        }
    }
}

fn action_preview(item: &Value) -> Option<Value> {
    let action = item["commandActions"].as_array()?.iter().find(|action| {
        action["type"]
            .as_str()
            .is_some_and(|kind| kind != "unknown")
    })?;
    let fields = ["type", "name", "query", "path"]
        .into_iter()
        .filter_map(|key| {
            let text = command_preview::text_preview(action[key].as_str()?);
            Some((key.to_owned(), json!(text)))
        })
        .collect::<serde_json::Map<_, _>>();
    Some(Value::Object(fields))
}

fn summarize_turn(turn: &mut Value, thread_id: &str) {
    let Some(turn_id) = turn["id"].as_str().map(str::to_owned) else {
        return;
    };
    if let Some(items) = turn["items"].as_array_mut() {
        for item in items {
            summarize_item(item, thread_id, &turn_id);
        }
    }
}

pub(super) fn summarize_thread(thread: &mut Value) {
    let Some(thread_id) = thread["id"].as_str().map(str::to_owned) else {
        return;
    };
    if let Some(turns) = thread["turns"].as_array_mut() {
        for turn in turns {
            summarize_turn(turn, &thread_id);
        }
    }
}

/// Approval requests must keep their complete input so the user can make an informed choice.
pub(super) fn event(mut event: Value) -> Option<Value> {
    if !event["id"].is_null() {
        return Some(event);
    }
    if matches!(
        event["method"].as_str(),
        Some("item/commandExecution/outputDelta" | "item/mcpToolCall/progress")
    ) {
        return None;
    }
    let params = &mut event["params"];
    let thread_id = params["threadId"].as_str().map(str::to_owned);
    if let Some(thread_id) = thread_id {
        if let Some(turn_id) = params["turnId"].as_str().map(str::to_owned) {
            if let Some(item) = params.get_mut("item") {
                summarize_item(item, &thread_id, &turn_id);
            }
        }
        if let Some(turn) = params.get_mut("turn") {
            summarize_turn(turn, &thread_id);
        }
    }
    if let Some(thread) = params.get_mut("thread") {
        summarize_thread(thread);
    }
    Some(event)
}

pub(super) async fn read(client: Connection, target: Target) -> Result<GuiResponse> {
    for id in [&target.thread_id, &target.turn_id, &target.item_id] {
        protocol::id(id)?;
    }
    // The live tail usually contains the requested command, avoiding a full history read on each refresh.
    let ids = (
        target.thread_id.clone(),
        target.turn_id.clone(),
        target.item_id.clone(),
    );
    let (client, live) = tauri::async_runtime::spawn_blocking(move || {
        let item = client.live_item(&ids.0, &ids.1, &ids.2)?;
        Ok::<_, GuiError>((client, item))
    })
    .await
    .map_err(|_| GuiError::InvalidRequest)??;
    if let Some(item) = live.filter(deferred) {
        return Ok(GuiResponse {
            data: json!({"item": item}),
        });
    }
    let mut data = client
        .request(
            "thread/read",
            json!({"threadId": target.thread_id, "includeTurns": true}),
        )
        .await?;
    tauri::async_runtime::spawn_blocking(move || {
        client.merge_live_history(&mut data);
        let item = take_item(&mut data, &target).ok_or(GuiError::InvalidRequest)?;
        Ok(GuiResponse {
            data: json!({"item": item}),
        })
    })
    .await
    .map_err(|_| GuiError::InvalidRequest)?
}

fn take_item(data: &mut Value, target: &Target) -> Option<Value> {
    if data["thread"]["id"] != target.thread_id {
        return None;
    }
    let turn = data["thread"]["turns"]
        .as_array_mut()?
        .iter_mut()
        .find(|turn| turn["id"] == target.turn_id)?;
    let item = turn["items"]
        .as_array_mut()?
        .iter_mut()
        .find(|item| item["id"] == target.item_id && deferred(item))?;
    Some(item.take())
}
