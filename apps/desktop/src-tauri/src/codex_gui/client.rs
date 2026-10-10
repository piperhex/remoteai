mod completion_notifications;
mod context_capacity;
mod context_change;
mod conversation_awareness;
mod deletion;
mod idle_threads;
mod live_settings;
mod plugin_refresh;
#[path = "title_service.rs"]
mod title_service;

use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};

use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{oneshot, Mutex},
    time::{timeout, Duration},
};

use super::{
    error::{GuiError, Result},
    identity, platform,
    protocol::{approval_response, ApprovalReply, GuiEvent},
    workspaces,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_CONCURRENT_TITLE_JOBS: usize = 2;
type Pending = HashMap<u64, oneshot::Sender<Result<Value>>>;

pub(super) struct Client {
    title_jobs: Mutex<std::collections::HashSet<String>>,
    title_writes: Mutex<()>,
    title_slots: tokio::sync::Semaphore,
    pub(super) home: PathBuf,
    pub(super) projectless_root: PathBuf,
    writer: Mutex<ChildStdin>,
    process: Mutex<Child>,
    pending: Mutex<Pending>,
    approvals: Mutex<HashMap<String, GuiEvent>>,
    active_turns: Mutex<HashMap<String, String>>,
    completion_notifications: Mutex<completion_notifications::CompletionNotifications>,
    context_capacity: context_capacity::ContextCapacity,
    idle_threads: idle_threads::IdleThreads,
    plugin_revision: Mutex<Option<String>>,
    next_id: AtomicU64,
    pub(super) alive: AtomicBool,
    events_enabled: AtomicBool,
    notification_session: String,
    app: AppHandle,
}

impl Client {
    pub(super) async fn start(
        app: AppHandle,
        executable: super::releases::Executable,
        home: PathBuf,
        projectless_root: PathBuf,
    ) -> Result<Arc<Self>> {
        let client = Self::start_staged(app, executable, home, projectless_root).await?;
        client.activate();
        Ok(client)
    }

    /// Handshake before replacing the current client; failed updates must not publish disconnects.
    pub(super) async fn start_staged(
        app: AppHandle,
        executable: super::releases::Executable,
        home: PathBuf,
        projectless_root: PathBuf,
    ) -> Result<Arc<Self>> {
        let mut command = Command::new(executable.path);
        // Keep every override in the app-server argument scope; subcommand overrides replace root ones.
        command.arg("app-server");
        super::conversation_tools::configure(app.clone(), &mut command).await?;
        command
            .arg("-c")
            .arg("features.step_model_switching=true")
            .arg("-c")
            .arg(format!("sqlite_home={}", json!(home.to_string_lossy())))
            .arg("-c")
            .arg(format!(
                "log_dir={}",
                json!(home.join("log").to_string_lossy())
            ))
            .env("CODEX_HOME", &home)
            .env(
                "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
                identity::CLI_ORIGINATOR,
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        platform::hide_window(&mut command);
        let mut process = command.spawn().map_err(|_| GuiError::Startup)?;
        let writer = process.stdin.take().ok_or(GuiError::Startup)?;
        let stdout = process.stdout.take().ok_or(GuiError::Startup)?;
        let client = Arc::new(Self {
            title_jobs: Mutex::default(),
            title_writes: Mutex::default(),
            title_slots: tokio::sync::Semaphore::new(MAX_CONCURRENT_TITLE_JOBS),
            home,
            projectless_root,
            writer: Mutex::new(writer),
            process: Mutex::new(process),
            pending: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            active_turns: Mutex::new(HashMap::new()),
            completion_notifications: Mutex::default(),
            context_capacity: context_capacity::ContextCapacity::default(),
            idle_threads: idle_threads::IdleThreads::default(),
            plugin_revision: Mutex::new(None),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            events_enabled: AtomicBool::new(false),
            notification_session: uuid::Uuid::new_v4().to_string(),
            app,
        });
        tokio::spawn(client.clone().read(stdout));
        let handshake = client
            .request(
                "initialize",
                identity::initialize_params(&executable.version),
            )
            .await;
        if handshake.is_err() {
            client.stop().await;
            return Err(GuiError::Startup);
        }
        if client
            .write(json!({"method": "initialized"}))
            .await
            .is_err()
        {
            client.stop().await;
            return Err(GuiError::Startup);
        }
        Ok(client)
    }

    pub(super) fn activate(self: &Arc<Self>) {
        self.events_enabled.store(true, Ordering::Release);
        self.start_idle_cleanup();
    }

    async fn write(&self, value: Value) -> Result<()> {
        let mut message = serde_json::to_vec(&value).map_err(|_| GuiError::InvalidRequest)?;
        message.push(b'\n');
        let mut writer = self.writer.lock().await;
        timeout(REQUEST_TIMEOUT, writer.write_all(&message))
            .await
            .map_err(|_| GuiError::Timeout)?
            .map_err(|_| GuiError::Disconnected)
    }

    pub(super) async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let _subscription = self.idle_threads.request_guard(method, &params).await;
        let mut result = self.request_internal(method, params).await?;
        super::conversation_context::display(&mut result);
        Ok(result)
    }

    async fn request_internal(&self, method: &str, mut params: Value) -> Result<Value> {
        if method == "thread/name/set" {
            let _guard = self.title_writes.lock().await;
            return self.request_raw(method, params).await;
        }
        super::home::scope_thread_request(method, &mut params);
        if method == "turn/interrupt" {
            return self.interrupt_with_context(params).await;
        }
        if matches!(method, "turn/start" | "turn/steer") {
            self.prepare_conversation_context(&mut params).await?;
        }
        if method == "turn/start" {
            self.refresh_plugins().await?;
        }
        if matches!(method, "thread/resume" | "turn/start") {
            return self.request_with_context(method, params).await;
        }
        self.request_raw(method, params).await
    }

    async fn request_raw(&self, method: &str, params: Value) -> Result<Value> {
        if !self.alive.load(Ordering::Acquire) {
            return Err(GuiError::Disconnected);
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);
        if let Err(error) = self
            .write(json!({"id": id, "method": method, "params": params}))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        let result = timeout(REQUEST_TIMEOUT, receiver).await;
        self.pending.lock().await.remove(&id);
        let result = result
            .map_err(|_| GuiError::Timeout)?
            .map_err(|_| GuiError::Disconnected)??;
        self.idle_threads.response(method, &params, &result).await;
        Ok(result)
    }

    async fn read(self: Arc<Self>, stdout: ChildStdout) {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            match serde_json::from_str::<Value>(&line) {
                Ok(value) => self.dispatch(value).await,
                Err(_) => eprintln!("Codex GUI ignored an invalid protocol message"),
            }
        }
        self.disconnect(true).await;
    }

    async fn dispatch(self: &Arc<Self>, value: Value) {
        if let Some(method) = value["method"].as_str() {
            // Legacy codex/event messages duplicate v2 events and can contain raw internal data.
            if method.starts_with("codex/event/") {
                return;
            }
            self.idle_threads.event(method, &value["params"]).await;
            let mut event = GuiEvent {
                method: method.to_owned(),
                params: value["params"].clone(),
                id: value.get("id").cloned(),
            };
            workspaces::hide_project_paths(&mut event.params, &self.projectless_root);
            super::push_notifications::identify(&mut event, &self.notification_session);
            if matches!(method, "turn/started" | "turn/completed") {
                self.track_live_turn(&event).await;
            }
            if method == "thread/tokenUsage/updated" {
                crate::local_proxy::gui_context::record_usage(&event.params).await;
            }
            if method == "turn/completed" {
                self.notify_completion(&event).await;
                if let Some(id) = event.params["turn"]["id"].as_str() {
                    self.approvals
                        .lock()
                        .await
                        .retain(|_, approval| approval.params["turnId"] != id);
                }
            }
            if let Some(id) = &event.id {
                if !matches!(
                    method,
                    "item/commandExecution/requestApproval"
                        | "item/fileChange/requestApproval"
                        | "item/tool/requestUserInput"
                        | "item/permissions/requestApproval"
                ) && !super::mcp_approval::supported(&event)
                {
                    if self
                        .write(json!({"id": id, "error": {"code": -32601,
                        "message": "This client does not support this request"}}))
                        .await
                        .is_err()
                    {
                        eprintln!("Codex GUI could not decline an unsupported request");
                    }
                    return;
                }
                self.approvals
                    .lock()
                    .await
                    .insert(id.to_string(), event.clone());
            }
            if method == "serverRequest/resolved" {
                self.approvals
                    .lock()
                    .await
                    .remove(&event.params["requestId"].to_string());
            }
            self.emit(event).await;
        } else if let Some(id) = value["id"].as_u64() {
            if let Some(sender) = self.pending.lock().await.remove(&id) {
                let result = if value.get("error").is_some() {
                    Err(GuiError::from_rpc(&value["error"]))
                } else {
                    Ok(value["result"].clone())
                };
                // A timed-out caller can drop its receiver before the response arrives.
                let _ = sender.send(result);
            }
        }
    }

    pub(super) async fn respond(&self, reply: ApprovalReply) -> Result<()> {
        let key = reply.id.to_string();
        let event = self
            .approvals
            .lock()
            .await
            .get(&key)
            .cloned()
            .ok_or(GuiError::InvalidRequest)?;
        let result = approval_response(&event, reply)?;
        self.write(json!({"id": event.id, "result": result}))
            .await?;
        self.approvals.lock().await.remove(&key);
        self.emit(GuiEvent {
            method: "serverRequest/resolved".into(),
            params: json!({"requestId": event.id}),
            id: None,
        })
        .await;
        Ok(())
    }

    pub(super) async fn pending_approvals(&self) -> Vec<GuiEvent> {
        self.approvals.lock().await.values().cloned().collect()
    }

    pub(super) async fn is_running(&self) -> bool {
        !self.active_turns.lock().await.is_empty() || !self.pending.lock().await.is_empty()
    }

    async fn emit(&self, mut event: GuiEvent) {
        if !self.events_enabled.load(Ordering::Acquire) {
            return;
        }
        super::push_notifications::receive(&self.app, &event, &self.notification_session);
        super::conversation_context::display(&mut event.params);
        super::web::publish(&self.app, "codex-gui-event", event);
    }

    async fn disconnect(&self, notify: bool) {
        if !self.alive.swap(false, Ordering::AcqRel) {
            return;
        }
        for (_, sender) in self.pending.lock().await.drain() {
            // Callers may already have timed out.
            let _ = sender.send(Err(GuiError::Disconnected));
        }
        self.approvals.lock().await.clear();
        if notify {
            self.emit(GuiEvent {
                method: "connection/closed".into(),
                params: json!({}),
                id: None,
            })
            .await;
        }
    }

    pub(super) async fn stop(&self) {
        self.disconnect(false).await;
        if self.process.lock().await.kill().await.is_err() {
            eprintln!("Codex GUI process was already stopped");
        }
    }
}
