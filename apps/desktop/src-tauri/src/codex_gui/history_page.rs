use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::error::{GuiError, Result};

const DEFAULT_PAGE_SIZE: usize = 10;

/// Resuming a background queue needs the latest lifecycle state, never the old message bodies.
pub(super) fn summarize(data: &mut Value) {
    let Some(turns) = data["thread"]["turns"].as_array_mut() else {
        return;
    };
    if turns.len() > 1 {
        turns.drain(..turns.len() - 1);
    }
    if let Some(turn) = turns.last_mut().and_then(Value::as_object_mut) {
        turn.insert("items".into(), json!([]));
        for key in ["diff", "plan", "planExplanation"] {
            turn.remove(key);
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryCursor {
    turn_id: String,
    item_id: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryWindow {
    start: Option<HistoryCursor>,
    #[serde(default)]
    older: bool,
    page_size: Option<usize>,
    #[serde(default)]
    defer_processes: bool,
}

impl HistoryWindow {
    pub(super) fn defers_processes(&self) -> bool {
        self.defer_processes
    }

    pub(super) fn has_enough_history(&self, turns: &[Value]) -> bool {
        let mut before = 0;
        let size = self.page_size.unwrap_or(DEFAULT_PAGE_SIZE);
        for turn in turns {
            let starts = page_starts(turn, self);
            let group = self
                .start
                .as_ref()
                .filter(|cursor| turn["id"].as_str() == Some(cursor.turn_id.as_str()))
                .and_then(|cursor| {
                    items(turn)
                        .iter()
                        .position(|item| item["id"].as_str() == Some(cursor.item_id.as_str()))
                })
                .and_then(|index| starts.iter().rposition(|start| *start <= index));
            if let Some(group) = group {
                return !self.older || before + group >= size;
            }
            before += starts.len();
        }
        self.start.is_none() && before >= size
    }

    pub(super) fn validate(&self) -> Result<()> {
        if self.page_size == Some(0) {
            return Err(GuiError::InvalidRequest);
        }
        if let Some(cursor) = &self.start {
            for id in [&cursor.turn_id, &cursor.item_id] {
                if id.is_empty() || id.chars().count() > 256 {
                    return Err(GuiError::InvalidRequest);
                }
            }
        }
        Ok(())
    }
}

fn items(turn: &Value) -> &[Value] {
    turn["items"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn boundary(turns: &[Value], window: &HistoryWindow) -> (usize, usize) {
    let mut count = 0;
    let mut anchor = None;
    for turn in turns {
        let starts = page_starts(turn, window);
        if let Some(cursor) = &window.start {
            if turn["id"].as_str() == Some(&cursor.turn_id) {
                anchor = items(turn)
                    .iter()
                    .position(|item| item["id"].as_str() == Some(&cursor.item_id))
                    .and_then(|index| starts.iter().rposition(|start| *start <= index))
                    .map(|index| count + index);
            }
        }
        count += starts.len();
    }
    let size = window.page_size.unwrap_or(DEFAULT_PAGE_SIZE);
    let start = anchor.map_or_else(
        || count.saturating_sub(size),
        |index| index.saturating_sub(if window.older { size } else { 0 }),
    );
    (start, count)
}

fn page_starts(turn: &Value, window: &HistoryWindow) -> Vec<usize> {
    if window.defer_processes {
        super::process_details::groups(items(turn))
            .iter()
            .map(|range| range.start)
            .collect()
    } else {
        (0..items(turn).len()).collect()
    }
}

/// Match the remote history cursor contract; retain all items from the boundary to the live tail.
/// Move values instead of cloning potentially large tool results or inline images.
pub(super) fn apply(data: &mut Value, window: &HistoryWindow) -> Result<()> {
    window.validate()?;
    if window.defer_processes {
        super::process_details::summarize_thread(&mut data["thread"]);
    }
    let turns = data["thread"]["turns"]
        .as_array_mut()
        .ok_or(GuiError::InvalidRequest)?;
    let (start, count) = boundary(turns, window);
    let mut offset = 0;
    turns.retain_mut(|turn| {
        let starts = page_starts(turn, window);
        let length = starts.len();
        let from = starts
            .get(start.saturating_sub(offset))
            .copied()
            .unwrap_or(items(turn).len());
        offset += length;
        let keep = offset > start || (offset == count && length == 0);
        if keep && from > 0 {
            if let Some(items) = turn["items"].as_array_mut() {
                items.drain(..from);
            }
        }
        keep
    });
    let cursor = turns.iter().find_map(|turn| {
        items(turn)
            .first()
            .map(|item| json!({ "turnId": turn["id"], "itemId": item["id"] }))
    });
    data["page"] = json!({ "hasMore": start > 0 });
    if let Some(cursor) = cursor {
        data["page"]["start"] = cursor;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_resume_keeps_lifecycle_state_without_message_bodies() {
        let mut data = history();
        data["thread"]["turns"][2]["status"] = json!("inProgress");
        data["thread"]["turns"][2]["diff"] = json!("large diff".repeat(100_000));
        summarize(&mut data);
        let turns = data["thread"]["turns"].as_array().unwrap();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0]["status"], "inProgress");
        assert_eq!(turns[0]["items"], json!([]));
        assert!(turns[0]["diff"].is_null());
    }

    fn history() -> Value {
        let turns: Vec<Value> = (0..3).map(|group| {
            let items: Vec<Value> = (group * 12..((group + 1) * 12).min(35)).map(|index| {
                json!({ "id": format!("item-{index}"), "type": "agentMessage",
                    "text": if index < 12 { "old".repeat(250_000) } else { format!("Message {index}") } })
            }).collect();
            json!({ "id": format!("turn-{group}"), "status": "completed", "items": items })
        }).collect();
        json!({ "thread": { "id": "chat", "turns": turns } })
    }

    #[test]
    fn pages_large_history_without_loss_and_keeps_trailing_state() {
        let mut source = history();
        source["thread"]["turns"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "id": "live", "status": "inProgress", "items": [] }));
        let mut window = HistoryWindow::default();
        for expected in [10, 20, 30, 35] {
            let mut page = source.clone();
            apply(&mut page, &window).unwrap();
            let turns = page["thread"]["turns"].as_array().unwrap();
            assert_eq!(
                turns.iter().map(|turn| items(turn).len()).sum::<usize>(),
                expected
            );
            assert_eq!(turns.last().unwrap()["id"], "live");
            assert_eq!(page["page"]["hasMore"], expected < 35);
            if expected == 10 {
                assert!(serde_json::to_vec(&page).unwrap().len() < 5000);
            }
            window =
                serde_json::from_value(json!({ "start": page["page"]["start"], "older": true }))
                    .unwrap();
        }
        let mut page = source.clone();
        apply(&mut page, &window).unwrap();
        assert_eq!(page["thread"], source["thread"]);
    }

    #[test]
    fn stable_cursor_survives_appends_and_deleted_cursor_resets() {
        let mut source = history();
        let mut first = source.clone();
        apply(&mut first, &HistoryWindow::default()).unwrap();
        source["thread"]["turns"][2]["items"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "id": "new" }));
        let window =
            serde_json::from_value(json!({ "start": first["page"]["start"], "older": true }))
                .unwrap();
        let mut page = source.clone();
        apply(&mut page, &window).unwrap();
        assert_eq!(page["page"]["start"]["itemId"], "item-15");
        let window =
            serde_json::from_value(json!({ "start": { "turnId": "gone", "itemId": "gone" } }))
                .unwrap();
        apply(&mut source, &window).unwrap();
        assert_eq!(source["page"]["start"]["itemId"], "item-26");
    }

    #[test]
    fn validates_windows_and_handles_empty_history() {
        for value in [
            json!({ "pageSize": 0 }),
            json!({ "start": { "turnId": "", "itemId": "item" } }),
        ] {
            assert!(serde_json::from_value::<HistoryWindow>(value)
                .unwrap()
                .validate()
                .is_err());
        }
        let mut data = json!({ "thread": { "turns": [] } });
        apply(&mut data, &HistoryWindow::default()).unwrap();
        assert_eq!(data["page"]["hasMore"], false);
        assert!(data["page"]["start"].is_null());
    }
}
