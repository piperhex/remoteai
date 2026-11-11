//! Resolve manual stops and persist their exact target under the continuation guard.
use std::{collections::HashMap, future::Future, sync::atomic::Ordering};

use serde_json::{json, Value};
use tokio::sync::Mutex;

use super::{context_capacity::ThreadCapacity, Client};
use crate::codex_gui::{
    error::{GuiError, Result},
    recovery::{access, Journal},
};

impl Client {
    pub(super) async fn interrupt_with_context(&self, params: Value) -> Result<Value> {
        let id = params["threadId"]
            .as_str()
            .ok_or(GuiError::InvalidRequest)?;
        let state = self.context_capacity.thread(id).await;
        Interrupt {
            state: &state,
            active_turns: &self.active_turns,
            journal: Journal::new(&self.home),
        }
        .run(params, |method, target| self.request_raw(method, target))
        .await
    }
}

struct Interrupt<'a> {
    state: &'a ThreadCapacity,
    active_turns: &'a Mutex<HashMap<String, String>>,
    journal: Journal,
}

impl Interrupt<'_> {
    async fn run<F>(
        self,
        mut params: Value,
        mut request: impl FnMut(&'static str, Value) -> F,
    ) -> Result<Value>
    where
        F: Future<Output = Result<Value>>,
    {
        let thread = params["threadId"]
            .as_str()
            .ok_or(GuiError::InvalidRequest)?
            .to_owned();
        if params["turnId"]
            .as_str()
            .filter(|id| !id.is_empty())
            .is_none()
        {
            return Err(GuiError::InvalidRequest);
        }
        // Cancel a pending continuation before waiting for the per-thread switch to finish.
        self.state.stops.fetch_add(1, Ordering::AcqRel);
        let _guard = self.state.applied.lock().await;
        let current = self.active_turns.lock().await.get(&thread).cloned();
        if let Some(turn) = &current {
            params["turnId"] = turn.clone().into();
        }
        let target = if current.is_none() {
            resolve_untracked_target(params, &mut request).await
        } else {
            StopTarget::Interrupt(params)
        };
        let (params, response) = match target {
            StopTarget::Interrupt(params) => {
                let response = request("turn/interrupt", params.clone()).await?;
                (params, response)
            }
            StopTarget::Paused(params) => (params, json!({})),
            StopTarget::Finished => return Ok(json!({})),
        };
        self.forget(params, response).await
    }

    async fn forget(&self, params: Value, response: Value) -> Result<Value> {
        let thread = params["threadId"]
            .as_str()
            .ok_or(GuiError::InvalidRequest)?
            .to_owned();
        let turn = params["turnId"]
            .as_str()
            .ok_or(GuiError::InvalidRequest)?
            .to_owned();
        // Keep failed/uncertain stops recoverable. Never clear a newer turn that started while
        // awaiting the acknowledgement, or another thread's record.
        if access(self.journal.clone(), move |journal| {
            journal.finished(&thread, &turn)
        })
        .await
        .is_err()
        {
            // Journal failure must not prevent the user's stop request.
            eprintln!("Codex GUI could not clear a stopped task recovery record");
        }
        Ok(response)
    }
}

enum StopTarget {
    Interrupt(Value),
    Paused(Value),
    Finished,
}

/// An empty event map can mean either a paused turn or a continuation whose started event
/// is still in flight. Confirm the engine's actual turn before treating Stop as a no-op.
async fn resolve_untracked_target<F>(
    mut params: Value,
    request: &mut impl FnMut(&'static str, Value) -> F,
) -> StopTarget
where
    F: Future<Output = Result<Value>>,
{
    let snapshot = request(
        "thread/read",
        json!({
            "threadId": params["threadId"], "includeTurns": true,
        }),
    )
    .await;
    // A read failure must not swallow Stop or authorize deleting a guessed record.
    let Ok(snapshot) = snapshot else {
        return StopTarget::Interrupt(params);
    };
    let thread = &snapshot["thread"];
    if thread["id"] != params["threadId"] {
        return StopTarget::Interrupt(params);
    }
    let turn = thread["turns"].as_array().and_then(|turns| turns.last());
    let Some(turn) = turn.filter(|turn| turn["id"].as_str().is_some_and(|id| !id.is_empty()))
    else {
        return StopTarget::Interrupt(params);
    };
    params["turnId"] = turn["id"].clone();
    match turn["status"].as_str() {
        Some("interrupted") if thread["status"]["type"] != "active" => StopTarget::Paused(params),
        Some("completed" | "failed") if thread["status"]["type"] != "active" => {
            StopTarget::Finished
        }
        _ => StopTarget::Interrupt(params),
    }
}

#[cfg(test)]
#[path = "interrupt_tests.rs"]
mod tests;
