//! Host-wide admission for tasks and worktree changes, independent of any connected UI.
mod conflict;
mod files;
#[cfg(test)]
mod files_tests;
mod lifecycle;
pub(super) use conflict::Conflict;
#[cfg(test)]
mod tests;

use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::Mutex;

use super::{
    error::{GuiError, Result},
    platform::comparable_path,
    protocol::directory,
};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct WorkspaceKey(String);

impl WorkspaceKey {
    /// Canonicalize aliases and group subdirectories, but keep linked worktrees independent.
    /// Filesystem access belongs on a blocking worker.
    pub(super) fn resolve(cwd: &str) -> Result<Self> {
        let path = directory(cwd)?;
        let root = path
            .ancestors()
            .find(|ancestor| ancestor.join(".git").exists())
            .unwrap_or(&path);
        Ok(Self(comparable_path(&root.to_string_lossy())))
    }

    pub(super) async fn from_cwd(cwd: String) -> Result<Self> {
        tauri::async_runtime::spawn_blocking(move || Self::resolve(&cwd))
            .await
            .map_err(|_| GuiError::Workspace)?
    }
}

/// Dropping the guard on success, error or cancellation reopens task admission.
pub(super) struct WorkspaceChange(Arc<AtomicBool>);

impl Drop for WorkspaceChange {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Default)]
pub(super) struct WorkspaceActivity(Mutex<Activity>);

#[derive(Default)]
struct Activity {
    changes: HashMap<WorkspaceKey, Arc<AtomicBool>>,
    sessions: HashMap<String, Session>,
}

#[derive(Default)]
struct Session {
    threads: HashMap<String, Thread>,
    requests: HashMap<u64, Pending>,
}

#[derive(Default)]
struct Thread {
    workspace: Option<WorkspaceKey>,
    cwd: Option<String>,
    name: Option<String>,
    turns: HashMap<String, Turn>,
    goal_files: HashSet<String>,
    active_snapshot: bool,
    goal_active: bool,
    turn_revision: u64,
    goal_revision: u64,
}

#[derive(Default)]
struct Turn {
    workspace: Option<WorkspaceKey>,
    files: HashSet<String>,
}

struct Pending {
    thread_id: Option<String>,
    workspace: Option<WorkspaceKey>,
    blocks: bool,
    turn_revision: u64,
    goal_revision: u64,
    completed: HashSet<String>,
    name: Option<String>,
    cwd: Option<String>,
}

#[derive(Clone, Copy)]
pub(super) struct WorkspaceRequest<'a> {
    pub(super) id: u64,
    pub(super) method: &'a str,
    pub(super) params: &'a Value,
}

/// Resume can restart a goal; reserve it just like an explicit turn submission.
pub(super) fn admits_work(method: &str, params: &Value) -> bool {
    matches!(
        method,
        "turn/start" | "thread/start" | "thread/resume" | "thread/fork" | "thread/compact/start"
    ) || (method == "thread/goal/set" && params["status"] == "active")
}

impl WorkspaceActivity {
    pub(super) async fn cwd(&self, session: &str, id: &str) -> Option<String> {
        self.0
            .lock()
            .await
            .sessions
            .get(session)?
            .threads
            .get(id)?
            .cwd
            .clone()
    }

    pub(super) async fn workspace(&self, session: &str, thread: &str) -> Option<WorkspaceKey> {
        self.0
            .lock()
            .await
            .sessions
            .get(session)?
            .threads
            .get(thread)?
            .workspace
            .clone()
    }

    pub(super) async fn begin(
        &self,
        session: &str,
        request: WorkspaceRequest<'_>,
        workspace: Option<WorkspaceKey>,
    ) -> Result<()> {
        let blocks = admits_work(request.method, request.params);
        let mut state = self.0.lock().await;
        if blocks {
            let key = workspace.as_ref().ok_or(GuiError::Workspace)?;
            if state
                .changes
                .get(key)
                .is_some_and(|active| active.load(Ordering::Acquire))
            {
                return Err(GuiError::WorkspaceBusy);
            }
        }
        let session = state.sessions.entry(session.to_owned()).or_default();
        let thread_id = request.params["threadId"].as_str().map(str::to_owned);
        let thread = thread_id
            .as_ref()
            .map(|id| session.threads.entry(id.clone()).or_default());
        let (turn_revision, goal_revision) = if let Some(thread) = thread {
            (thread.turn_revision, thread.goal_revision)
        } else {
            (0, 0)
        };
        session.requests.insert(
            request.id,
            Pending {
                thread_id,
                workspace,
                blocks,
                turn_revision,
                goal_revision,
                completed: HashSet::new(),
                name: (request.method == "thread/name/set")
                    .then(|| request.params["name"].as_str().map(str::to_owned))
                    .flatten(),
                cwd: request.params["cwd"].as_str().map(str::to_owned),
            },
        );
        Ok(())
    }

    pub(super) async fn change(&self, key: WorkspaceKey) -> Result<WorkspaceChange> {
        let mut state = self.0.lock().await;
        state
            .changes
            .retain(|_, active| active.load(Ordering::Acquire));
        if state.changes.contains_key(&key) {
            return Err(GuiError::WorkspaceBusy);
        }
        if state.sessions.values().any(|session| session.busy(&key)) {
            return Err(GuiError::WorkspaceConflict(Conflict::tasks(&state, &key)));
        }
        let active = Arc::new(AtomicBool::new(true));
        state.changes.insert(key, Arc::clone(&active));
        Ok(WorkspaceChange(active))
    }

    /// Keep uncertain timed-out submissions reserved until a reply or process exit.
    pub(super) async fn disconnect(&self, session: &str) {
        self.0.lock().await.sessions.remove(session);
    }
}

fn conflicts(workspace: &Option<WorkspaceKey>, key: &WorkspaceKey) -> bool {
    // An unsolicited task without directory metadata must not permit a blind checkout.
    workspace.as_ref().is_none_or(|workspace| workspace == key)
}

impl Session {
    fn busy(&self, key: &WorkspaceKey) -> bool {
        self.requests
            .values()
            .any(|request| request.blocks && conflicts(&request.workspace, key))
            || self.threads.values().any(|thread| thread.busy(key))
    }
}
