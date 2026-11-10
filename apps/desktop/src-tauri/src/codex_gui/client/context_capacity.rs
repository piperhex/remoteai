//! Rejoin only the stopped conversation whose capacity changed; keep the app server and phone connected.
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};

use serde_json::{json, Value};
use tokio::{
    sync::{Mutex, Notify},
    time::{timeout, Duration},
};

use super::Client;
use crate::codex_gui::{
    context_settings::{self, ContextSettings},
    error::{GuiError, Result},
};

// A systemError session cannot accept resume overrides while it remains loaded in Codex.
// The GUI owns subscription lifetimes; release only the unsubscribed target before rejoining it.
pub(super) const UNLOAD_CONFIG: &str = "thread_unload_delay_secs=0";
const UNLOAD_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub(super) struct ThreadCapacity {
    pub(super) applied: Mutex<ContextSettings>,
    invalidated: AtomicBool,
    pub(super) stops: AtomicU64,
    pub(super) last_start: Mutex<Option<Value>>,
    unloads: AtomicU64,
    unloaded: Notify,
}

impl ThreadCapacity {
    pub(super) fn is_applied(&self, applied: &ContextSettings, settings: &ContextSettings) -> bool {
        !self.invalidated.load(Ordering::Acquire) && applied == settings
    }

    pub(super) fn invalidate(&self) {
        self.invalidated.store(true, Ordering::Release);
    }

    pub(super) fn confirm(&self) {
        self.invalidated.store(false, Ordering::Release);
    }

    async fn wait_for_unload(&self, generation: u64) {
        loop {
            let notified = self.unloaded.notified();
            if self.unloads.load(Ordering::Acquire) != generation {
                return;
            }
            notified.await;
        }
    }
}

type SharedCapacity = Arc<ThreadCapacity>;

#[derive(Default)]
pub(super) struct ContextCapacity(Mutex<HashMap<String, SharedCapacity>>);

impl ContextCapacity {
    pub(super) async fn thread(&self, id: &str) -> SharedCapacity {
        self.0
            .lock()
            .await
            .entry(id.to_owned())
            .or_default()
            .clone()
    }

    pub(super) async fn response(&self, method: &str, params: &Value, result: &Value) {
        if method == "thread/unsubscribe" && super::idle_threads::released(result) {
            self.invalidate(params, false).await;
        }
    }

    pub(super) async fn event(&self, method: &str, params: &Value) {
        if matches!(
            method,
            "thread/closed" | "thread/archived" | "thread/deleted"
        ) || (method == "thread/status/changed" && params["status"]["type"] == "notLoaded")
        {
            self.invalidate(params, method == "thread/closed").await;
        }
    }

    async fn invalidate(&self, params: &Value, unloaded: bool) {
        let Some(id) = params["threadId"].as_str() else {
            return;
        };
        if let Some(state) = self.0.lock().await.get(id) {
            // The RPC caller can hold applied while waiting for this event. Never wait on that guard here.
            state.invalidate();
            if unloaded {
                state.unloads.fetch_add(1, Ordering::Release);
                state.unloaded.notify_one();
            }
        }
    }
}

impl Client {
    pub(super) async fn request_with_context(
        &self,
        method: &str,
        mut params: Value,
    ) -> Result<Value> {
        let id = params["threadId"]
            .as_str()
            .ok_or(GuiError::InvalidRequest)?;
        let state = self.context_capacity.thread(id).await;
        // Serialize resume/send for this conversation, including the full rejoin and its acknowledgement.
        let mut applied = state.applied.lock().await;
        let settings = context_settings::for_thread(self.app.clone(), id.to_owned())
            .await
            .map_err(|_| GuiError::ContextSettings)?;
        let model_params = self.context_model_params(id, &params).await?;
        let settings = self.effective_context(&settings, &model_params).await?;
        if !state.is_applied(&applied, &settings)
            && self.reload_context(id, &settings, &applied).await?
        {
            *applied = settings;
            state.confirm();
        }
        if method == "thread/resume" {
            context_settings::apply_capacity(&mut params, &applied);
        }
        // Check under the same per-thread guard used by all resume/send requests.
        if let Some(expected) = params
            .as_object_mut()
            .and_then(|params| params.remove(crate::codex_gui::recovery::EXPECTED_TURN))
        {
            let entry = crate::codex_gui::recovery::Entry {
                thread_id: params["threadId"]
                    .as_str()
                    .ok_or(GuiError::InvalidRequest)?
                    .to_owned(),
                turn_id: expected
                    .as_str()
                    .ok_or(GuiError::InvalidRequest)?
                    .to_owned(),
                observed_at: 0,
            };
            let snapshot = self
                .request_raw(
                    "thread/read",
                    json!({"threadId": entry.thread_id, "includeTurns": true}),
                )
                .await?;
            if !crate::codex_gui::recovery::same_interrupted_turn(&snapshot["thread"], &entry) {
                return Err(GuiError::RecoveryChanged);
            }
        }
        let continuation = super::context_change::continuation_overrides(&params);
        let result = self.request_raw(method, params).await?;
        if method == "turn/start" {
            *state.last_start.lock().await = Some(continuation);
        }
        Ok(result)
    }

    pub(super) async fn reload_context(
        &self,
        id: &str,
        settings: &ContextSettings,
        previous: &ContextSettings,
    ) -> Result<bool> {
        if self.active_turns.lock().await.contains_key(id) {
            return Ok(false);
        }
        let mut read_params = json!({"threadId": id, "excludeTurns": true});
        crate::codex_gui::home::scope_thread_request("thread/resume", &mut read_params);
        let snapshot = self.request_raw("thread/resume", read_params).await?;
        // The server can start autonomous turns; its status is authoritative even before our event arrives.
        if !idle_snapshot(id, &snapshot)? {
            return Ok(false);
        }
        let mut params = resume_settings(id, &snapshot)?;
        let mut fallback = params.clone();
        context_settings::apply_capacity(&mut fallback, previous);
        context_settings::apply_capacity(&mut params, settings);
        if let Err(error) = self.unload_for_context(id).await {
            if self.request_raw("thread/resume", fallback).await.is_err() {
                eprintln!("Codex GUI could not restore the conversation after an unload failure");
            }
            return Err(error);
        }
        // Rejoining with config explicitly present applies overrides on the supported CLI, including reset.
        // Do not restart the shared process: other conversations and pending approvals must survive.
        if self.request_raw("thread/resume", params).await.is_err() {
            if self.request_raw("thread/resume", fallback).await.is_err() {
                eprintln!("Codex GUI could not restore the previous context settings");
            }
            return Err(GuiError::ContextSettings);
        }
        self.restore_legacy_sandbox(id, &snapshot).await?;
        Ok(true)
    }

    async fn unload_for_context(&self, id: &str) -> Result<()> {
        let state = self.context_capacity.thread(id).await;
        let generation = state.unloads.load(Ordering::Acquire);
        let response = self
            .request_raw("thread/unsubscribe", json!({"threadId": id}))
            .await?;
        if !super::idle_threads::released(&response) {
            return Err(GuiError::Rpc);
        }
        if response["status"] == "notLoaded" {
            return Ok(());
        }
        // Unsubscribe is only an acknowledgement; overrides require the actual thread/closed event.
        timeout(UNLOAD_TIMEOUT, state.wait_for_unload(generation))
            .await
            .map_err(|_| GuiError::Timeout)
    }

    async fn restore_legacy_sandbox(&self, id: &str, snapshot: &Value) -> Result<()> {
        if snapshot
            .pointer("/activePermissionProfile/id")
            .and_then(Value::as_str)
            .is_none()
        {
            self.request_raw(
                "thread/settings/update",
                json!({
                    "threadId": id, "sandboxPolicy": snapshot["sandbox"],
                }),
            )
            .await?;
        }
        Ok(())
    }
}

pub(super) fn idle_snapshot(id: &str, snapshot: &Value) -> Result<bool> {
    if snapshot.pointer("/thread/id").and_then(Value::as_str) != Some(id) {
        return Err(GuiError::ContextSettings);
    }
    match snapshot
        .pointer("/thread/status/type")
        .and_then(Value::as_str)
    {
        // Codex reports systemError only after excluding running turns and pending approvals/input.
        Some("idle" | "notLoaded" | "systemError") => Ok(true),
        Some("active") => Ok(false),
        _ => Err(GuiError::ContextSettings),
    }
}

fn resume_settings(id: &str, snapshot: &Value) -> Result<Value> {
    let mut params = json!({"threadId": id, "excludeTurns": true, "config": {}});
    for key in [
        "model",
        "modelProvider",
        "serviceTier",
        "cwd",
        "runtimeWorkspaceRoots",
        "approvalPolicy",
        "approvalsReviewer",
    ] {
        if let Some(value) = snapshot.get(key) {
            params[key] = value.clone();
        }
    }
    if let Some(effort) = snapshot
        .get("reasoningEffort")
        .filter(|value| !value.is_null())
    {
        params["config"]["model_reasoning_effort"] = effort.clone();
    }
    if let Some(profile) = snapshot
        .pointer("/activePermissionProfile/id")
        .and_then(Value::as_str)
    {
        params["permissions"] = profile.into();
    } else {
        // Preserve the complete legacy policy through thread/settings/update after rejoining.
        // Refuse unsupported policy shapes instead of silently widening filesystem access.
        params["sandbox"] = match snapshot.pointer("/sandbox/type").and_then(Value::as_str) {
            Some("readOnly") => "read-only",
            Some("workspaceWrite") => "workspace-write",
            Some("dangerFullAccess") => "danger-full-access",
            _ => return Err(GuiError::ContextSettings),
        }
        .into();
    }
    Ok(params)
}

#[cfg(test)]
#[path = "context_capacity_tests.rs"]
mod tests;
