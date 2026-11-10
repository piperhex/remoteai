//! Host-owned recovery decisions shared by desktop and authenticated remote clients.
mod store;

use super::{client::Client, error::GuiError, protocol::GuiResponse};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const RECENT_MS: i64 = 24 * 60 * 60 * 1000;
const CONCURRENCY: usize = 4;
pub(super) const EVENT: &str = "recovery/changed";
pub(super) const EXPECTED_TURN: &str = "_restartRecoveryTurnId";

#[derive(Debug, thiserror::Error)]
pub(super) enum Error {
    #[error("client.taskRecovery.unavailable")]
    Storage,
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Entry {
    pub(super) thread_id: String,
    pub(super) turn_id: String,
    pub(super) observed_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Decision {
    batch_id: String,
    action: Action,
    entries: Vec<Entry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Action {
    Resume,
    Dismiss,
}

pub(super) fn same_interrupted_turn(thread: &Value, entry: &Entry) -> bool {
    let turn = thread["turns"].as_array().and_then(|turns| turns.last());
    thread["id"] == entry.thread_id
        && thread["status"]["type"] != "active"
        && turn.is_some_and(|turn| turn["id"] == entry.turn_id && turn["status"] == "interrupted")
}

fn eligible(thread: &Value, entry: &Entry) -> bool {
    let cutoff = chrono::Utc::now().timestamp_millis() - RECENT_MS;
    same_interrupted_turn(thread, entry)
        && thread["parentThreadId"].is_null()
        && thread["source"].get("subAgent").is_none()
        && thread["archived"] != true
        && (entry.observed_at >= cutoff
            || thread["updatedAt"].as_i64().unwrap_or(0) * 1000 >= cutoff)
}

impl Client {
    pub(super) async fn record_recovery_event(&self, method: &str, params: &Value) {
        if matches!(method, "thread/archived" | "thread/deleted") {
            if let Some(thread) = params["threadId"].as_str() {
                if self.forget_recovery_thread(thread).await.is_err() {
                    eprintln!("Codex GUI could not clear an archived task recovery record");
                }
            }
            return;
        }
        let started = method == "turn/started";
        // Unexpected interruptions survive; an explicit stop removes its exact record before dispatch.
        if !started && (method != "turn/completed" || params["turn"]["status"] == "interrupted") {
            return;
        }
        let (Some(thread), Some(turn)) =
            (params["threadId"].as_str(), params["turn"]["id"].as_str())
        else {
            return;
        };
        let (thread, turn) = (thread.to_owned(), turn.to_owned());
        let result = store::access(store::Journal::new(&self.home), move |journal| {
            if started {
                journal.started(&thread, &turn)
            } else {
                journal.finished(&thread, &turn)
            }
        })
        .await;
        if result.is_err() {
            eprintln!("Codex GUI could not persist task recovery state");
        }
    }

    pub(super) async fn forget_recovery_turn(&self, params: &Value) -> super::error::Result<()> {
        let (Some(thread), Some(turn)) = (params["threadId"].as_str(), params["turnId"].as_str())
        else {
            return Ok(());
        };
        let (thread, turn) = (thread.to_owned(), turn.to_owned());
        store::access(store::Journal::new(&self.home), move |journal| {
            journal.finished(&thread, &turn)
        })
        .await
        .map_err(GuiError::Recovery)?;
        Ok(())
    }

    pub(super) async fn forget_recovery_thread(&self, thread: &str) -> super::error::Result<()> {
        let thread = thread.to_owned();
        store::access(store::Journal::new(&self.home), move |journal| {
            journal.remove_thread(&thread)
        })
        .await
        .map_err(GuiError::Recovery)
    }

    async fn recovery_thread(&self, entry: &Entry) -> super::error::Result<Value> {
        let response = self
            .request(
                "thread/read",
                json!({"threadId": entry.thread_id, "includeTurns": true}),
            )
            .await?;
        Ok(response["thread"].clone())
    }

    pub(super) async fn recovery_list(&self) -> super::error::Result<GuiResponse> {
        let entries = store::access(store::Journal::new(&self.home), |journal| journal.pending())
            .await
            .map_err(GuiError::Recovery)?;
        let checked: Vec<_> = stream::iter(entries)
            .map(|entry| async move {
                let result = self.recovery_thread(&entry).await;
                (entry, result)
            })
            .buffer_unordered(CONCURRENCY)
            .collect()
            .await;
        let mut candidates = Vec::new();
        let mut obsolete = Vec::new();
        for (entry, result) in checked {
            let thread = result?;
            if eligible(&thread, &entry) {
                candidates.push(json!({"entry": entry, "title": title(&thread)}));
            } else {
                obsolete.push(entry);
            }
        }
        if !obsolete.is_empty() {
            store::access(store::Journal::new(&self.home), move |journal| {
                journal.claim(&obsolete)
            })
            .await
            .map_err(GuiError::Recovery)?;
        }
        Ok(GuiResponse {
            data: json!({"batchId": store::launch_id(), "candidates": candidates}),
        })
    }

    pub(super) async fn recovery_decide(
        &self,
        decision: Decision,
    ) -> super::error::Result<GuiResponse> {
        if decision.batch_id != store::launch_id() || decision.entries.len() > 1000 {
            return Err(GuiError::InvalidRequest);
        }
        let entries = store::access(store::Journal::new(&self.home), move |journal| {
            journal.claim(&decision.entries)
        })
        .await
        .map_err(GuiError::Recovery)?;
        self.emit(super::protocol::GuiEvent {
            method: EVENT.into(),
            params: json!({}),
            id: None,
        })
        .await;
        let failed = if matches!(decision.action, Action::Resume) {
            stream::iter(entries)
                .map(|entry| self.resume_recovery_entry(entry))
                .buffer_unordered(CONCURRENCY)
                .filter_map(|entry| async { entry })
                .collect::<Vec<_>>()
                .await
        } else {
            Vec::new()
        };
        Ok(GuiResponse {
            data: json!({"failed": failed}),
        })
    }

    async fn resume_recovery_entry(&self, entry: Entry) -> Option<Value> {
        let mut name = String::new();
        let result: super::error::Result<()> = async {
            let thread = self.recovery_thread(&entry).await?;
            if !eligible(&thread, &entry) {
                return Ok(());
            }
            name = title(&thread);
            self.request(
                "thread/resume",
                json!({"threadId": entry.thread_id, "excludeTurns": true}),
            )
            .await?;
            self.request(
                "turn/start",
                json!({"threadId": entry.thread_id, "input": [],
                "turnTrigger": "resume_interrupted_task", EXPECTED_TURN: entry.turn_id}),
            )
            .await?;
            Ok(())
        }
        .await;
        match result {
            Ok(()) | Err(GuiError::RecoveryChanged) => None,
            Err(_) => Some(json!({"threadId": entry.thread_id, "title": name})),
        }
    }
}

fn title(thread: &Value) -> String {
    ["name", "preview"]
        .into_iter()
        .filter_map(|key| thread[key].as_str())
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
        .chars()
        .take(100)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_requires_the_same_interrupted_root_turn() {
        let entry = Entry {
            thread_id: "thread".into(),
            turn_id: "turn".into(),
            observed_at: chrono::Utc::now().timestamp_millis(),
        };
        let mut thread = json!({"id":"thread","status":{"type":"notLoaded"},
            "turns":[{"id":"turn","status":"interrupted"}]});
        assert!(eligible(&thread, &entry));
        thread["status"]["type"] = json!("active");
        assert!(!eligible(&thread, &entry));
        thread["status"]["type"] = json!("idle");
        thread["turns"][0]["id"] = json!("new-turn");
        assert!(!eligible(&thread, &entry));
        thread["turns"][0]["id"] = json!("turn");
        thread["parentThreadId"] = json!("parent");
        assert!(!eligible(&thread, &entry));
    }
}
