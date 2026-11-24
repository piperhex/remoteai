use super::Client;
use crate::codex_gui::worktree_observation::Baseline;
use crate::codex_gui::{protocol::GuiEvent, turn_review};
use serde_json::json;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

type ReviewStart = (String, Option<Baseline>);
type TurnKey = (String, String);

#[derive(Default)]
pub(super) struct Baselines {
    pub(super) pending: HashMap<u64, (String, ReviewStart)>,
    active: HashMap<TurnKey, ReviewStart>,
    gaps: HashSet<TurnKey>,
}

impl Client {
    pub(super) async fn bind_review(&self, request: u64, result: &Value) {
        let start = self.review_baselines.lock().await.pending.remove(&request);
        let (Some((thread, start)), Some(turn)) = (start, result["turn"]["id"].as_str()) else {
            return;
        };
        let (home, cwd, key) = (
            self.home.clone(),
            start.0.clone(),
            (thread, turn.to_owned()),
        );
        let record = key.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            turn_review::bind_cwd(&home, &record.0, &record.1, &cwd)
        })
        .await;
        let mut state = self.review_baselines.lock().await;
        if !matches!(result, Ok(Ok(_))) {
            state.gaps.insert(key.clone());
        }
        if !matches!(result, Ok(Ok(true))) {
            state.active.insert(key, start);
        }
    }
    pub(super) async fn begin_review(&self, request: u64, params: &Value) {
        let Some(thread) = params["threadId"].as_str() else {
            return;
        };
        let cwd = match params["cwd"].as_str() {
            Some(cwd) => Some(cwd.to_owned()),
            None => {
                self.workspaces
                    .cwd(&self.notification_session, thread)
                    .await
            }
        };
        if let Some(cwd) = cwd {
            let path = cwd.clone();
            let baseline = tauri::async_runtime::spawn_blocking(move || Baseline::start(&path))
                .await
                .ok()
                .flatten();
            self.review_baselines
                .lock()
                .await
                .pending
                .insert(request, (thread.to_owned(), (cwd, baseline)));
        }
    }

    pub(super) async fn record_turn_review(&self, event: &mut GuiEvent) {
        let Some(thread) = event.params["threadId"].as_str() else {
            return;
        };
        let Some(turn) = event.params["turnId"]
            .as_str()
            .or(event.params["turn"]["id"].as_str())
        else {
            return;
        };
        let key = (thread.to_owned(), turn.to_owned());
        let state = self.review_baselines.lock().await;
        let mut cwd = state.active.get(&key).map(|start| start.0.clone());
        let pending = state.pending.values().any(|(thread, _)| thread == &key.0);
        let incomplete = state.gaps.contains(&key);
        drop(state);
        if cwd.is_none() && !pending && event.method == "turn/started" {
            cwd = self
                .workspaces
                .cwd(&self.notification_session, &key.0)
                .await;
        }
        if event.params["turn"].is_object() {
            if let Some(cwd) = &cwd {
                event.params["turn"]["reviewCwd"] = json!(cwd);
            }
            if incomplete {
                event.params["turn"]["reviewIncomplete"] = json!(true);
            }
        } else if incomplete {
            event.params["reviewIncomplete"] = json!(true);
        }
        if event.method == "turn/completed" {
            let baseline = self.review_baselines.lock().await.active.remove(&key);
            if let Some((_, Some(baseline))) = baseline {
                if let Ok(observed) =
                    tauri::async_runtime::spawn_blocking(move || baseline.finish()).await
                {
                    event.params["turn"]["workspaceObservation"] = json!(observed);
                }
            }
        }
        let home = self.home.clone();
        let snapshot = event.clone();
        let finished = event.method == "turn/completed";
        let stored = tauri::async_runtime::spawn_blocking(move || {
            turn_review::record(&home, &snapshot, cwd)?;
            if !finished {
                return Ok(None);
            }
            let turn = &snapshot.params["turn"];
            let mut history = json!({"id":snapshot.params["threadId"],
                "turns":[{"id":turn["id"],"status":turn["status"]}]});
            turn_review::restore(&home, &mut history)?;
            Ok::<_, rusqlite::Error>(Some(history["turns"][0].take()))
        })
        .await;
        if let Ok(Ok(saved)) = stored {
            if let Some(saved) = saved {
                for field in ["diff", "reviewCwd", "reviewIncomplete"] {
                    event.params["turn"][field] = saved[field].clone();
                }
            }
            if incomplete {
                self.review_baselines.lock().await.gaps.remove(&key);
            }
        } else {
            eprintln!("Could not persist turn review evidence");
            self.review_baselines.lock().await.gaps.insert(key);
            if event.params["turn"].is_object() {
                event.params["turn"]["reviewIncomplete"] = json!(true);
            }
        }
    }
}
