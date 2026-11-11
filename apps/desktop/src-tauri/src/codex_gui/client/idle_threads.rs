//! Release idle GUI subscriptions so the engine can reclaim their MCP sessions.
use std::{collections::HashMap, sync::Arc};

use serde_json::{json, Value};
use tokio::{
    sync::{Mutex, OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock},
    time::{Duration, Instant},
};

use super::{Client, GuiError, Result};

const IDLE_DELAY: Duration = Duration::from_secs(60);
const SWEEP_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Default)]
pub(super) struct IdleThreads(Mutex<HashMap<String, Arc<Subscription>>>);

#[derive(Default)]
struct Subscription {
    requests: Arc<RwLock<()>>,
    last_activity: Mutex<Option<Instant>>,
}

impl IdleThreads {
    pub(super) async fn deletion_guard(&self, id: &str) -> Result<OwnedRwLockWriteGuard<()>> {
        self.thread(id)
            .await
            .requests
            .clone()
            .try_write_owned()
            .map_err(|_| GuiError::Busy)
    }

    async fn thread(&self, id: &str) -> Arc<Subscription> {
        self.0
            .lock()
            .await
            .entry(id.to_owned())
            .or_default()
            .clone()
    }

    /// Keep a mutation and its acknowledgement serialized against unsubscribe.
    pub(super) async fn protect(&self, id: &str) -> OwnedRwLockReadGuard<()> {
        let thread = self.thread(id).await;
        let guard = thread.requests.clone().read_owned().await;
        *thread.last_activity.lock().await = Some(Instant::now());
        guard
    }

    pub(super) async fn request_guard(
        &self,
        method: &str,
        params: &Value,
    ) -> Option<OwnedRwLockReadGuard<()>> {
        let id = params["threadId"].as_str()?;
        // Reading history or polling goals must not keep unused tool processes alive.
        if matches!(
            method,
            "thread/read"
                | "thread/turns/list"
                | "thread/items/list"
                | "thread/items/read"
                | "thread/goal/get"
                | "thread/name/set"
        ) {
            return Some(self.thread(id).await.requests.clone().read_owned().await);
        }
        Some(self.protect(id).await)
    }

    pub(super) async fn response(&self, method: &str, params: &Value, result: &Value) {
        match method {
            "thread/start" | "thread/resume" | "thread/fork" => {
                if let Some(id) = result["thread"]["id"].as_str() {
                    *self.thread(id).await.last_activity.lock().await = Some(Instant::now());
                }
            }
            "thread/unsubscribe" if released(result) => {
                if let Some(id) = params["threadId"].as_str() {
                    self.forget(id).await;
                }
            }
            "thread/archive" => {
                if let Some(id) = params["threadId"].as_str() {
                    self.forget(id).await;
                }
            }
            _ => {}
        }
    }

    pub(super) async fn event(&self, method: &str, params: &Value) {
        let Some(id) = params["threadId"].as_str() else {
            return;
        };
        if matches!(
            method,
            "thread/closed" | "thread/archived" | "thread/deleted"
        ) {
            self.forget(id).await;
        } else if matches!(
            method,
            "turn/started" | "turn/completed" | "thread/goal/updated"
        ) {
            if let Some(thread) = self.0.lock().await.get(id) {
                let mut activity = thread.last_activity.lock().await;
                if activity.is_some() {
                    *activity = Some(Instant::now());
                }
            }
        }
    }

    async fn forget(&self, id: &str) {
        if let Some(thread) = self.0.lock().await.get(id) {
            // Retain the gate: a concurrent request may already be waiting on this same subscription.
            *thread.last_activity.lock().await = None;
        }
    }

    async fn candidates(&self) -> Vec<(String, Arc<Subscription>)> {
        let threads: Vec<_> = self
            .0
            .lock()
            .await
            .iter()
            .map(|(id, thread)| (id.clone(), thread.clone()))
            .collect();
        let mut candidates = Vec::new();
        for (id, thread) in threads {
            if thread.expired().await {
                candidates.push((id, thread));
            }
        }
        candidates
    }
}

impl Subscription {
    async fn expired(&self) -> bool {
        self.last_activity
            .lock()
            .await
            .is_some_and(|last| last.elapsed() >= IDLE_DELAY)
    }
}

impl Client {
    /// Inspect every loaded session, including child sessions and autonomous goals.
    /// The caller holds the GUI activity gate so no new GUI operation can start.
    pub(in crate::codex_gui) async fn ready_for_update(&self) -> Result<bool> {
        if self.is_running().await || !self.approvals.lock().await.is_empty() {
            return Ok(false);
        }
        if !inspect_loaded_threads(|method, params| self.request_raw(method, params)).await? {
            return Ok(false);
        }
        Ok(!self.is_running().await && self.approvals.lock().await.is_empty())
    }

    pub(super) fn start_idle_cleanup(self: &Arc<Self>) {
        let client = Arc::downgrade(self);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(SWEEP_INTERVAL).await;
                let Some(client) = client
                    .upgrade()
                    .filter(|client| client.alive.load(std::sync::atomic::Ordering::Acquire))
                else {
                    return;
                };
                // One worker awaits the whole sweep; slow RPCs cannot create overlapping sweeps.
                for (id, thread) in client.idle_threads.candidates().await {
                    if let Err(error) = client.release_idle_thread(&id, &thread).await {
                        eprintln!("Codex GUI idle subscription cleanup: {error}");
                    }
                }
            }
        });
    }

    async fn release_idle_thread(&self, id: &str, thread: &Subscription) -> Result<()> {
        let Ok(_requests) = thread.requests.clone().try_write_owned() else {
            return Ok(());
        };
        let capacity = self.context_capacity.thread(id).await;
        let Ok(_settings) = capacity.applied.try_lock() else {
            return Ok(());
        };
        if !thread.expired().await || self.active_turns.lock().await.contains_key(id) {
            return Ok(());
        }
        if self
            .approvals
            .lock()
            .await
            .values()
            .any(|event| event.params["threadId"] == id)
        {
            return Ok(());
        }
        match inspect_thread(id, |method, params| self.request_raw(method, params)).await? {
            ReleaseDecision::Wait => return Ok(()),
            ReleaseDecision::NotLoaded => {
                capacity.invalidate();
                self.idle_threads.forget(id).await;
                return Ok(());
            }
            ReleaseDecision::Unsubscribe => {}
        }
        if !thread.expired().await || self.active_turns.lock().await.contains_key(id) {
            return Ok(());
        }
        // Unsubscribe lets app-server apply its own inactivity grace period. Never kill a helper
        // just because a tool call finished: its STDIO connection belongs to the entire session.
        let response = self
            .request_raw("thread/unsubscribe", json!({"threadId": id}))
            .await?;
        if !released(&response) {
            return Err(GuiError::Rpc);
        }
        Ok(())
    }
}

#[derive(Debug, PartialEq)]
pub(super) enum ReleaseDecision {
    Wait,
    NotLoaded,
    Unsubscribe,
}

async fn inspect_loaded_threads<F, Fut>(mut request: F) -> Result<bool>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: std::future::Future<Output = Result<Value>>,
{
    let loaded = request("thread/loaded/list", json!({})).await?;
    let Some(ids) = loaded["data"]
        .as_array()
        .filter(|_| loaded["nextCursor"].is_null())
    else {
        return Ok(false);
    };
    for id in ids {
        let Some(id) = id.as_str() else {
            return Ok(false);
        };
        if inspect_thread(id, &mut request).await? == ReleaseDecision::Wait {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) async fn inspect_thread<F, Fut>(id: &str, mut request: F) -> Result<ReleaseDecision>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: std::future::Future<Output = Result<Value>>,
{
    let params = json!({"threadId": id});
    let snapshot = request("thread/read", params.clone()).await?;
    if snapshot["thread"]["id"] != id {
        return Err(GuiError::Rpc);
    }
    match snapshot["thread"]["status"]["type"].as_str() {
        Some("notLoaded") => return Ok(ReleaseDecision::NotLoaded),
        Some("idle") => {}
        _ => return Ok(ReleaseDecision::Wait),
    }
    let goal = request("thread/goal/get", params.clone()).await?;
    if !inactive_goal(&goal) {
        return Ok(ReleaseDecision::Wait);
    }
    let terminals = request("thread/backgroundTerminals/list", params.clone()).await?;
    if !empty_page(&terminals) {
        return Ok(ReleaseDecision::Wait);
    }
    let queue = request("thread/queue/list", params).await?;
    if !empty_page(&queue) {
        return Ok(ReleaseDecision::Wait);
    }
    Ok(ReleaseDecision::Unsubscribe)
}

pub(super) fn released(response: &Value) -> bool {
    matches!(
        response["status"].as_str(),
        Some("unsubscribed" | "notSubscribed" | "notLoaded")
    )
}

fn inactive_goal(response: &Value) -> bool {
    match response.get("goal") {
        Some(Value::Null) => true,
        Some(goal) => matches!(
            goal["status"].as_str(),
            Some("paused" | "complete" | "blocked" | "budgetLimited")
        ),
        None => false,
    }
}

fn empty_page(response: &Value) -> bool {
    response["data"].as_array().is_some_and(Vec::is_empty) && response["nextCursor"].is_null()
}

#[cfg(test)]
#[path = "idle_threads_tests.rs"]
mod tests;
