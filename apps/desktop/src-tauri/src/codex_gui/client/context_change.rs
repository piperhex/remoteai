//! Apply capacity changes between an acknowledged interruption and a continuation in the same thread.
use std::sync::atomic::Ordering;

use serde_json::{json, Value};
use tokio::time::{sleep, timeout, Duration};

use super::{context_capacity::idle_snapshot, Client};
use crate::codex_gui::{
    context_settings::{self, ContextSettings, ContextUpdate},
    error::{GuiError, Result},
};

const INTERRUPT_EVENT_TIMEOUT: Duration = Duration::from_secs(10);
const INTERRUPT_EVENT_POLL: Duration = Duration::from_millis(20);

impl Client {
    pub(in crate::codex_gui) async fn change_context(
        &self,
        id: &str,
        settings: &ContextSettings,
    ) -> Result<ContextUpdate> {
        let _subscription = self.idle_threads.protect(id).await;
        let state = self.context_capacity.thread(id).await;
        let mut applied = state.applied.lock().await;
        let previous = context_settings::for_thread(self.app.clone(), id.to_owned())
            .await
            .map_err(|_| GuiError::ContextSettings)?;
        let stops = state.stops.load(Ordering::Acquire);
        let snapshot = self.context_snapshot(id).await?;
        let effective = self.effective_context(settings, &snapshot).await?;
        if state.is_applied(&applied, &effective) && previous == *settings {
            return Ok(ContextUpdate::Applied);
        }
        let continuation =
            continuation_params(id, &snapshot, state.last_start.lock().await.as_ref());
        let interrupted = self.pause_for_context(id, &snapshot).await?;
        if !self.reload_context(id, &effective, &applied).await? {
            return Err(GuiError::Busy);
        }
        self.persist_context_change(id, settings, &applied).await?;
        *applied = effective;
        state.confirm();
        if !interrupted {
            return Ok(ContextUpdate::Applied);
        }
        if state.stops.load(Ordering::Acquire) != stops {
            return Ok(ContextUpdate::Paused);
        }
        if self.request_raw("turn/start", continuation).await.is_err() {
            return Ok(ContextUpdate::ResumeFailed);
        }
        Ok(ContextUpdate::Continued)
    }

    async fn persist_context_change(
        &self,
        id: &str,
        settings: &ContextSettings,
        previous: &ContextSettings,
    ) -> Result<()> {
        if context_settings::persist(self.app.clone(), id.to_owned(), settings.clone())
            .await
            .is_err()
        {
            // Keep the old saved choice authoritative when storage fails. Leave the task paused on failure.
            if !matches!(self.reload_context(id, previous, settings).await, Ok(true)) {
                eprintln!("Codex GUI could not restore capacity after a save failure");
            }
            return Err(GuiError::ContextSettings);
        }
        Ok(())
    }

    async fn context_snapshot(&self, id: &str) -> Result<Value> {
        let mut params = json!({"threadId": id, "excludeTurns": true});
        crate::codex_gui::home::scope_thread_request("thread/resume", &mut params);
        self.request_raw("thread/resume", params).await
    }

    async fn pause_for_context(&self, id: &str, snapshot: &Value) -> Result<bool> {
        if idle_snapshot(id, snapshot)? {
            return Ok(false);
        }
        let turn_id = self
            .active_turns
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or(GuiError::Busy)?;
        // A nonempty turn id is acknowledged only after the CLI has stopped that specific turn.
        match self
            .request_raw("turn/interrupt", json!({"threadId": id, "turnId": turn_id}))
            .await
        {
            Ok(_) => {}
            Err(GuiError::Rpc) if idle_snapshot(id, &self.context_snapshot(id).await?)? => {
                // A turn that finished naturally before the interrupt must not be restarted.
                return Ok(false);
            }
            Err(error) => return Err(error),
        }
        // The CLI acknowledges interruption before publishing turn/completed. Wait for our event reader
        // to observe completion before testing its active-turn map or unloading the conversation.
        timeout(INTERRUPT_EVENT_TIMEOUT, async {
            while self.active_turns.lock().await.get(id) == Some(&turn_id) {
                sleep(INTERRUPT_EVENT_POLL).await;
            }
        })
        .await
        .map_err(|_| GuiError::Timeout)?;
        Ok(true)
    }
}

pub(super) fn continuation_overrides(params: &Value) -> Value {
    let mut overrides = json!({});
    for key in [
        "summary",
        "personality",
        "outputSchema",
        "collaborationMode",
        "serviceTierForTurn",
    ] {
        if let Some(value) = params.get(key) {
            overrides[key] = value.clone();
        }
    }
    overrides
}

fn continuation_params(id: &str, snapshot: &Value, previous: Option<&Value>) -> Value {
    let mut params = json!({"threadId": id,
        "input": [{"type": "text", "text": "请继续完成刚才中断的任务。"}]});
    if let Some(previous) = previous {
        for (key, value) in continuation_overrides(previous)
            .as_object()
            .into_iter()
            .flatten()
        {
            params[key] = value.clone();
        }
    }
    for key in [
        "model",
        "serviceTier",
        "approvalPolicy",
        "approvalsReviewer",
    ] {
        if let Some(value) = snapshot.get(key) {
            params[key] = value.clone();
        }
    }
    if let Some(effort) = snapshot.get("reasoningEffort") {
        params["effort"] = effort.clone();
    }
    // Collaboration settings take precedence over the top-level model and effort.
    if params["collaborationMode"]["settings"].is_object() {
        params["collaborationMode"]["settings"]["model"] = snapshot["model"].clone();
        params["collaborationMode"]["settings"]["reasoning_effort"] =
            snapshot["reasoningEffort"].clone();
    }
    params
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn continuation_retains_task_settings_but_never_replays_the_original_input() {
        let snapshot = json!({"model": "live-model", "reasoningEffort": "high",
            "approvalPolicy": "on-request", "approvalsReviewer": "user", "serviceTier": "fast"});
        let previous = json!({"input": [{"text": "run a payment"}], "model": "old-model",
            "outputSchema": {"type": "object"}, "serviceTierForTurn": "default",
            "collaborationMode": {"mode": "plan", "settings": {
                "model": "old-model", "reasoning_effort": "low", "developer_instructions": "retain"}}});
        let params = continuation_params("one", &snapshot, Some(&previous));
        assert_eq!(
            params["input"],
            json!([{"type": "text", "text": "请继续完成刚才中断的任务。"}])
        );
        assert_eq!(
            params["collaborationMode"]["settings"],
            json!({"model": "live-model",
            "reasoning_effort": "high", "developer_instructions": "retain"})
        );
        assert_eq!(params["outputSchema"], previous["outputSchema"]);
        assert_eq!(params["serviceTierForTurn"], "default");
        assert_eq!(params["approvalPolicy"], "on-request");
        assert!(params.get("permissions").is_none());
        assert!(params.get("sandboxPolicy").is_none());
    }
}
