//! Read only the persisted history needed by the GUI's current message window.
use std::{collections::HashSet, future::Future};

use serde_json::{json, Value};

use super::{
    error::{GuiError, Result},
    history_page::HistoryWindow,
};

const TURNS_PER_PAGE: usize = 8;

pub(super) async fn read<F, Fut>(
    id: &str,
    window: &HistoryWindow,
    mut request: F,
) -> Result<(Value, bool)>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value>>,
{
    let mut data = request("thread/read", json!({"threadId":id,"includeTurns":false})).await?;
    if data["thread"]["id"].as_str() != Some(id) {
        return Err(GuiError::Rpc);
    }
    let mut turns = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen = HashSet::new();
    loop {
        let mut page = request(
            "thread/turns/list",
            json!({"threadId":id,
            "limit":TURNS_PER_PAGE,"sortDirection":"desc","itemsView":"full","cursor":cursor}),
        )
        .await?;
        let mut older = page["data"]
            .as_array_mut()
            .map(std::mem::take)
            .ok_or(GuiError::Rpc)?;
        older.reverse();
        older.append(&mut turns);
        turns = older;
        let next = match &page["nextCursor"] {
            Value::Null => None,
            Value::String(value) if !value.is_empty() => Some(value.clone()),
            _ => return Err(GuiError::Rpc),
        };
        if let Some(next) = &next {
            if !seen.insert(next.clone()) {
                return Err(GuiError::Rpc);
            }
        }
        if next.is_none() || window.has_enough_history(&turns) {
            data["thread"]["turns"] = Value::Array(turns);
            return Ok((data, next.is_some()));
        }
        cursor = next;
    }
}

#[cfg(test)]
#[path = "native_history_tests.rs"]
mod tests;
