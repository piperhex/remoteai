use super::{Error, Request, Result};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Weak,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::{oneshot, Mutex},
};

const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(55);
type Pending = HashMap<u64, oneshot::Sender<Result<Value>>>;

pub(super) struct Client {
    writer: Mutex<ChildStdin>,
    _shutdown: oneshot::Sender<()>,
    pending: Mutex<Pending>,
    next_id: AtomicU64,
    alive: AtomicBool,
}

fn paths(app: &AppHandle) -> Result<(PathBuf, PathBuf)> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| Error::Startup)?
        .join("cli-gui");
    std::fs::create_dir_all(&root).map_err(|_| Error::Startup)?;
    let resource = app
        .path()
        .resource_dir()
        .map_err(|_| Error::Startup)?
        .join("resources/cli-gui/host.mjs");
    #[cfg(debug_assertions)]
    let resource = if resource.is_file() {
        resource
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/cli-gui/host.mjs")
    };
    if !resource.is_file() {
        return Err(Error::Startup);
    }
    Ok((root, resource))
}

impl Client {
    pub(super) fn alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }

    pub(super) async fn start(app: AppHandle) -> Result<Arc<Self>> {
        let path_app = app.clone();
        let (root, script) = tauri::async_runtime::spawn_blocking(move || paths(&path_app))
            .await
            .map_err(|_| Error::Startup)??;
        let bundled_node = script
            .parent()
            .and_then(|path| path.parent())
            .map(|path| path.join("desktop-service/node.exe"));
        let executable = bundled_node
            .filter(|path| cfg!(windows) && path.is_file())
            .unwrap_or_else(|| PathBuf::from("node"));
        let log_root = root.clone();
        let log = tauri::async_runtime::spawn_blocking(move || {
            std::fs::File::create(log_root.join("worker.log"))
        })
        .await
        .map_err(|_| Error::Startup)?
        .map_err(|_| Error::Startup)?;
        let mut command = Command::new(executable);
        command
            .arg(script)
            .arg(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(log))
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let mut process = command.spawn().map_err(|_| Error::Startup)?;
        #[cfg(windows)]
        let job = super::windows_job::track(&process)?;
        let writer = process.stdin.take().ok_or(Error::Startup)?;
        let stdout = process.stdout.take().ok_or(Error::Startup)?;
        let (shutdown, stopped) = oneshot::channel::<()>();
        tokio::spawn(async move {
            #[cfg(windows)]
            let _job = job;
            tokio::select! {
                result = process.wait() => {
                    if result.is_err() { eprintln!("CLI worker wait failed"); }
                }
                _ = stopped => {
                    // Dropping stdin lets the worker stop its daemon and CLI children gracefully.
                    if tokio::time::timeout(Duration::from_secs(15), process.wait()).await.is_err()
                        && process.kill().await.is_err() { eprintln!("CLI worker shutdown failed"); }
                }
            }
        });
        let client = Arc::new(Self {
            writer: Mutex::new(writer),
            _shutdown: shutdown,
            pending: Mutex::default(),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
        });
        tokio::spawn(Self::read(Arc::downgrade(&client), app, stdout));
        Ok(client)
    }

    pub(super) async fn request(&self, request: Request) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (send, receive) = oneshot::channel();
        self.pending.lock().await.insert(id, send);
        let mut bytes = serde_json::to_vec(&json!({"id": id, "request": request}))
            .map_err(|_| Error::Invalid)?;
        bytes.push(b'\n');
        let written = tokio::time::timeout(REQUEST_TIMEOUT, async {
            self.writer.lock().await.write_all(&bytes).await
        })
        .await;
        if !matches!(written, Ok(Ok(()))) {
            self.pending.lock().await.remove(&id);
            return Err(Error::Connection);
        }
        let result = tokio::time::timeout(REQUEST_TIMEOUT, receive).await;
        self.pending.lock().await.remove(&id);
        result
            .map_err(|_| Error::Connection)?
            .map_err(|_| Error::Connection)?
    }

    async fn read(weak: Weak<Self>, app: AppHandle, output: tokio::process::ChildStdout) {
        let mut reader = BufReader::new(output);
        loop {
            let mut line = Vec::new();
            let result = (&mut reader)
                .take(MAX_FRAME_BYTES as u64 + 1)
                .read_until(b'\n', &mut line)
                .await;
            if !matches!(result, Ok(size) if size > 0 && size <= MAX_FRAME_BYTES) {
                break;
            }
            let Some(client) = weak.upgrade() else {
                break;
            };
            let Ok(frame) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            if frame["event"].as_bool() == Some(true) {
                crate::codex_gui::web::publish(
                    &app,
                    "codex-gui-event",
                    &json!({
                        "method":"cliGui/changed", "params":{}, "id":null
                    }),
                );
                continue;
            }
            let Some(id) = frame["id"].as_u64() else {
                continue;
            };
            let sender = client.pending.lock().await.remove(&id);
            if let Some(sender) = sender {
                let result = if let Some(error) = frame["error"].as_str() {
                    Err(Error::Worker(safe_error(error).to_owned()))
                } else {
                    Ok(frame["data"].clone())
                };
                // A timed-out caller deliberately drops its response receiver.
                drop(sender.send(result));
            }
        }
        if let Some(client) = weak.upgrade() {
            client.alive.store(false, Ordering::Release);
            for (_, sender) in client.pending.lock().await.drain() {
                drop(sender.send(Err(Error::Connection)));
            }
        }
    }
}

fn safe_error(value: &str) -> &str {
    if value.starts_with("client.cliGui.")
        && value.len() < 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphabetic() || byte == b'.')
    {
        value
    } else {
        "client.cliGui.requestFailed"
    }
}
