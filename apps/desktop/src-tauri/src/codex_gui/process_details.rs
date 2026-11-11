//! Fold completed process groups before history crosses IPC; expand one exact group on demand.
use std::{collections::HashMap, ops::Range};

use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    connection::Connection,
    error::{GuiError, Result},
    protocol::{self, GuiResponse},
    tool_details, workspaces,
};

#[cfg(test)]
#[path = "process_details_tests.rs"]
mod tests;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Target {
    thread_id: String,
    turn_id: String,
    item_id: String,
    end_item_id: String,
}

fn message(item: &Value, index: usize, last_answer: Option<usize>) -> bool {
    match item["type"].as_str() {
        Some("userMessage" | "modelChange") => true,
        Some("agentMessage") => {
            item["phase"] == "final_answer"
                || (item["phase"].is_null() && last_answer == Some(index))
        }
        _ => false,
    }
}

pub(super) fn groups(items: &[Value]) -> Vec<Range<usize>> {
    let last_answer = items
        .iter()
        .rposition(|item| item["type"] == "agentMessage");
    let mut ranges: Vec<Range<usize>> = Vec::new();
    let mut previous_work = false;
    for (index, item) in items.iter().enumerate() {
        let work = !message(item, index, last_answer);
        if work && previous_work {
            if let Some(range) = ranges.last_mut() {
                range.end = index + 1;
            }
        } else {
            ranges.push(index..index + 1);
        }
        previous_work = work;
    }
    ranges
}

fn visible(item: &Value) -> bool {
    match item["type"].as_str() {
        Some("agentMessage") => item["text"]
            .as_str()
            .is_some_and(|text| !text.trim().is_empty()),
        Some("reasoning") => ["summary", "content"].iter().any(|key| {
            item[key].as_array().is_some_and(|parts| {
                parts
                    .iter()
                    .any(|part| part.as_str().is_some_and(|text| !text.trim().is_empty()))
            })
        }),
        _ => true,
    }
}

fn summary(items: &mut [Value], thread_id: &str, turn_id: &Value) -> Option<Value> {
    let count = items.iter().filter(|item| visible(item)).count();
    if count == 0 {
        return None;
    }
    let mut item = json!({"id": items[0]["id"], "type": "processSummary", "activityCount": count,
        "processRef": {"threadId": thread_id, "turnId": turn_id,
            "itemId": items[0]["id"], "endItemId": items[items.len() - 1]["id"]},
        "processCommandMetrics": command_metrics(items)});
    // These outputs already appear outside the process disclosure. Do not hide images or file changes.
    item["processOutputs"] = Value::Array(
        items
            .iter_mut()
            .filter(|item| {
                matches!(
                    item["type"].as_str(),
                    Some("fileChange" | "imageGeneration")
                )
            })
            .map(Value::take)
            .collect(),
    );
    Some(item)
}

fn command_metrics(items: &[Value]) -> Value {
    let mut outcomes = HashMap::new();
    for item in items {
        if item["type"] != "commandExecution" {
            continue;
        }
        let outcome = if item["status"] == "failed" {
            Some(false)
        } else if item["status"] == "completed" {
            item["exitCode"]
                .as_i64()
                .filter(|code| code.unsigned_abs() <= MAX_SAFE_INTEGER)
                .map(|code| code == 0)
        } else {
            None
        };
        if let Some(success) = outcome {
            outcomes.insert(item["id"].as_str(), success);
        }
    }
    json!({"successfulCommandCount": outcomes.values().filter(|success| **success).count(),
        "completedCommandCount": outcomes.len()})
}

fn summarize_turn(turn: &mut Value, thread_id: &str) {
    if turn["status"] != "completed" {
        return;
    }
    let turn_id = turn["id"].clone();
    let errors = turn["requestErrors"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let Some(items) = turn["items"].as_array_mut() else {
        return;
    };
    let last_answer = items
        .iter()
        .rposition(|item| item["type"] == "agentMessage");
    let mut output = Vec::new();
    for range in groups(items) {
        if message(&items[range.start], range.start, last_answer)
            || items[range.clone()]
                .iter()
                .any(|item| item["processRef"].is_object())
        {
            output.extend(items[range].iter_mut().map(Value::take));
            continue;
        }
        let mut start = range.start;
        for end in range.start + 1..=range.end {
            let boundary = errors
                .iter()
                .any(|error| error["afterItemId"] == items[end - 1]["id"]);
            if end != range.end && !boundary {
                continue;
            }
            if let Some(item) = summary(&mut items[start..end], thread_id, &turn_id) {
                output.push(item);
            }
            start = end;
        }
    }
    *items = output;
    remap_errors(turn);
}

fn remap_errors(turn: &mut Value) {
    let anchors: Vec<_> = turn["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["processRef"].is_object())
        .map(|item| (item["processRef"]["endItemId"].clone(), item["id"].clone()))
        .collect();
    if let Some(errors) = turn["requestErrors"].as_array_mut() {
        for error in errors {
            if let Some((_, id)) = anchors.iter().find(|(end, _)| *end == error["afterItemId"]) {
                error["afterItemId"] = id.clone();
            }
        }
    }
}

pub(super) fn summarize_thread(thread: &mut Value) {
    let Some(id) = thread["id"].as_str().map(str::to_owned) else {
        return;
    };
    if let Some(turns) = thread["turns"].as_array_mut() {
        for turn in turns {
            summarize_turn(turn, &id);
        }
    }
}

fn take_items(data: &mut Value, target: &Target) -> Result<Value> {
    if data["thread"]["id"] != target.thread_id {
        return Err(GuiError::InvalidRequest);
    }
    let turn = data["thread"]["turns"]
        .as_array_mut()
        .and_then(|turns| turns.iter_mut().find(|turn| turn["id"] == target.turn_id))
        .ok_or(GuiError::InvalidRequest)?;
    let items = turn["items"]
        .as_array_mut()
        .ok_or(GuiError::InvalidRequest)?;
    let start = items
        .iter()
        .position(|item| item["id"] == target.item_id)
        .ok_or(GuiError::InvalidRequest)?;
    let end = items
        .iter()
        .position(|item| item["id"] == target.end_item_id)
        .ok_or(GuiError::InvalidRequest)?;
    let last = items
        .iter()
        .rposition(|item| item["type"] == "agentMessage");
    if start > end
        || message(&items[start], start, last)
        || !groups(items)
            .iter()
            .any(|range| range.contains(&start) && range.contains(&end))
    {
        return Err(GuiError::InvalidRequest);
    }
    Ok(Value::Array(items.drain(start..=end).collect()))
}

fn prepare_items(data: &mut Value, target: &Target) -> Result<Value> {
    let items = take_items(data, target)?;
    let mut thread = json!({"id": target.thread_id,
        "turns": [{"id": target.turn_id, "items": items}]});
    // Opening the process loads its whole list; individual execution payloads stay independently lazy.
    tool_details::summarize_thread(&mut thread);
    Ok(thread["turns"][0]["items"].take())
}

pub(super) async fn read(client: Connection, target: Target) -> Result<GuiResponse> {
    for id in [
        &target.thread_id,
        &target.turn_id,
        &target.item_id,
        &target.end_item_id,
    ] {
        protocol::id(id)?;
    }
    let mut data =
        super::history_access::turn(&target.thread_id, &target.turn_id, |method, params| {
            client.request(method, params)
        })
        .await?;
    tauri::async_runtime::spawn_blocking(move || {
        client.merge_live_history(&mut data);
        let mut result = json!({"items": prepare_items(&mut data, &target)?});
        workspaces::hide_project_paths(&mut result, &client.projectless_root);
        Ok(GuiResponse { data: result })
    })
    .await
    .map_err(|_| GuiError::InvalidRequest)?
}
