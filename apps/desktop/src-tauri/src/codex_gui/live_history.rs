//! The app-server can notify a live item before its history read includes it. Keep that tail
//! outside the WebView so switching subscriptions never loses output from a running turn.
use std::collections::{HashMap, VecDeque};

use serde_json::{json, Value};

use super::protocol::GuiEvent;

const COMPLETED_THREADS: usize = 32;
const COMPLETED_BYTES: usize = 16 * 1024 * 1024;
const MAX_PROGRESS_MESSAGES: usize = 50;

#[derive(Default)]
pub(super) struct LiveHistory {
    turns: HashMap<String, Value>,
    completed: VecDeque<String>,
}

impl LiveHistory {
    pub(super) fn receive(&mut self, event: &GuiEvent) {
        let Some(id) = event.params["threadId"]
            .as_str()
            .or_else(|| event.params["thread"]["id"].as_str())
        else {
            return;
        };
        let method = event.method.as_str();
        if matches!(
            method,
            "thread/deleted" | "thread/historyChanged" | "thread/compacted"
        ) {
            self.turns.remove(id);
            self.completed.retain(|entry| entry != id);
            return;
        }
        if event.id.is_some() {
            return;
        }
        if !matches!(
            method,
            "turn/started"
                | "turn/completed"
                | "turn/diff/updated"
                | "turn/plan/updated"
                | "item/started"
                | "item/completed"
                | "item/mcpToolCall/progress"
                | "item/agentMessage/delta"
                | "item/plan/delta"
                | "item/commandExecution/outputDelta"
                | "item/fileChange/outputDelta"
                | "item/reasoning/summaryTextDelta"
                | "item/reasoning/textDelta"
        ) {
            return;
        }
        let Some(turn_id) = event.params["turnId"]
            .as_str()
            .or_else(|| event.params["turn"]["id"].as_str())
        else {
            return;
        };
        if !self.turns.contains_key(id) || method == "turn/started" {
            self.completed.retain(|entry| entry != id);
            self.turns.insert(
                id.to_owned(),
                json!({"id": turn_id, "status": "inProgress", "items": []}),
            );
        }
        let Some(turn) = self.turns.get_mut(id) else {
            return;
        };
        // Late notifications from an older turn cannot overwrite the current live tail.
        if turn["id"] != turn_id {
            return;
        }
        update_turn(turn, event);
        if method == "turn/completed" {
            self.completed.retain(|entry| entry != id);
            self.completed.push_back(id.to_owned());
            // Keep the newest completion during the short history persistence gap, even if
            // a single tool result exceeds the cache budget. Older completed tails are evictable.
            while self.completed.len() > 1
                && (self.completed.len() > COMPLETED_THREADS
                    || self.completed_bytes() > COMPLETED_BYTES)
            {
                if let Some(old) = self.completed.pop_front() {
                    self.turns.remove(&old);
                }
            }
        }
    }

    fn completed_bytes(&self) -> usize {
        self.completed
            .iter()
            .filter_map(|id| self.turns.get(id))
            .map(value_bytes)
            .sum()
    }

    pub(super) fn merge(&self, data: &mut Value) {
        let Some(live) = data["thread"]["id"]
            .as_str()
            .and_then(|id| self.turns.get(id))
        else {
            return;
        };
        let Some(turns) = data["thread"]["turns"].as_array_mut() else {
            return;
        };
        if let Some(turn) = turns.iter_mut().find(|turn| turn["id"] == live["id"]) {
            let finished = turn["status"] != "inProgress" && live["status"] == "inProgress";
            let status = turn["status"].clone();
            merge_turn(turn, live);
            if finished {
                turn["status"] = status;
            }
        } else {
            turns.push(live.clone());
        }
    }
}

fn merge_turn(turn: &mut Value, incoming: &Value) {
    if let Some(fields) = incoming.as_object() {
        for (key, value) in fields {
            if key != "items" {
                turn[key] = value.clone();
            }
        }
    }
    if let Some(items) = incoming["items"].as_array() {
        for (index, item) in items.iter().enumerate() {
            insert_before_next_known(turn, item, &items[index + 1..]);
            let target = item_mut(turn, &item["id"]);
            if let (Some(target), Some(source)) = (target.as_object_mut(), item.as_object()) {
                for (key, value) in source {
                    target.insert(key.clone(), value.clone());
                }
            }
        }
    }
}

fn insert_before_next_known(turn: &mut Value, item: &Value, following: &[Value]) {
    let Some(items) = turn["items"].as_array_mut() else {
        return;
    };
    if items.iter().any(|entry| entry["id"] == item["id"]) {
        return;
    }
    let before = following
        .iter()
        .find_map(|next| items.iter().position(|entry| entry["id"] == next["id"]));
    if let Some(index) = before {
        items.insert(index, item.clone());
    }
}

fn item_mut<'a>(turn: &'a mut Value, id: &Value) -> &'a mut Value {
    if !turn["items"].is_array() {
        turn["items"] = json!([]);
    }
    let items = turn["items"]
        .as_array_mut()
        .expect("items was initialized as an array");
    let index = items
        .iter()
        .position(|item| item["id"] == *id)
        .unwrap_or_else(|| {
            items.push(json!({"id": id, "type": "agentMessage"}));
            items.len() - 1
        });
    &mut items[index]
}

fn update_turn(turn: &mut Value, event: &GuiEvent) {
    let params = &event.params;
    match event.method.as_str() {
        "turn/started" | "turn/completed" => merge_turn(turn, &params["turn"]),
        "item/started" | "item/completed" => {
            let item = &params["item"];
            if item["id"].is_string() {
                *item_mut(turn, &item["id"]) = item.clone();
            }
        }
        "turn/diff/updated" => turn["diff"] = params["diff"].clone(),
        "turn/plan/updated" => {
            turn["plan"] = params["plan"].clone();
            turn["planExplanation"] = params["explanation"].clone();
        }
        "item/mcpToolCall/progress" => {
            if !params["itemId"].is_string() {
                return;
            }
            let item = item_mut(turn, &params["itemId"]);
            let mut progress = item["progress"].as_array().cloned().unwrap_or_default();
            progress.push(params["message"].clone());
            progress.drain(..progress.len().saturating_sub(MAX_PROGRESS_MESSAGES));
            item["progress"] = json!(progress);
        }
        _ => append_delta(turn, event),
    }
}

fn append_delta(turn: &mut Value, event: &GuiEvent) {
    let params = &event.params;
    let Some(delta) = params["delta"].as_str() else {
        return;
    };
    if !params["itemId"].is_string() {
        return;
    }
    let (kind, field) = match event.method.as_str() {
        "item/agentMessage/delta" => ("agentMessage", "text"),
        "item/plan/delta" => ("plan", "text"),
        "item/commandExecution/outputDelta" => ("commandExecution", "aggregatedOutput"),
        "item/fileChange/outputDelta" => ("fileChange", "aggregatedOutput"),
        "item/reasoning/summaryTextDelta" => ("reasoning", "summary"),
        "item/reasoning/textDelta" => ("reasoning", "content"),
        _ => return,
    };
    let item = item_mut(turn, &params["itemId"]);
    item["type"] = json!(kind);
    if kind == "reasoning" {
        let index = params["summaryIndex"]
            .as_u64()
            .or_else(|| params["contentIndex"].as_u64())
            .unwrap_or(0);
        // Reject malformed protocol indices without allocating unbounded empty arrays.
        if index > 4096 {
            return;
        }
        let mut parts = item[field].as_array().cloned().unwrap_or_default();
        parts.resize_with(parts.len().max(index as usize + 1), || json!(""));
        append_text(&mut parts[index as usize], delta);
        item[field] = json!(parts);
    } else {
        append_text(&mut item[field], delta);
    }
}

fn append_text(value: &mut Value, delta: &str) {
    if !value.is_string() {
        *value = json!("");
    }
    if let Value::String(text) = value {
        text.push_str(delta);
    }
}

fn value_bytes(value: &Value) -> usize {
    match value {
        Value::String(value) => value.len(),
        Value::Array(values) => values.iter().map(value_bytes).sum(),
        Value::Object(values) => values
            .iter()
            .map(|(key, value)| key.len() + value_bytes(value))
            .sum(),
        _ => std::mem::size_of::<Value>(),
    }
}

#[cfg(test)]
#[path = "live_history_tests.rs"]
mod tests;
