//! The GUI owns its built-in MCP workers; Codex only lends them its existing standard streams.
//! A successful launcher exits after the host acknowledges creation. No protocol proxy is involved.
mod native;
mod pipe;
#[cfg(debug_assertions)]
mod probe;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};
use tokio::sync::oneshot;

const HOST_ENV: &str = "REMOTEAI_PLUGIN_HOST";
const WORKER_ARGUMENT: &str = "--plugin-host-owned";
const PREFIXES: [&str; 3] = [
    "--chrome-mcp=",
    "--computer-use-mcp=",
    "--remote-command-mcp=",
];

#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("plugin process handoff failed")]
    Unavailable,
}
type Result<T> = std::result::Result<T, Error>;

/// Codex forwards only explicitly listed environment variables to STDIO servers.
pub(crate) fn configure_entry(table: &mut toml_edit::Table) {
    table["env_vars"] = toml_edit::value(toml_edit::Array::from_iter([HOST_ENV]));
}

#[derive(Serialize, Deserialize)]
struct Endpoint {
    channel: uuid::Uuid,
    owner: u32,
    arguments: [String; 3],
}

#[derive(Serialize, Deserialize)]
struct Request {
    argument: String,
    streams: [usize; 3],
}

pub(crate) struct Host {
    endpoint: String,
    stop: Mutex<Option<oneshot::Sender<()>>>,
}

impl Host {
    pub(crate) fn start(home: &Path) -> Result<Self> {
        let allowed = [
            crate::chrome_plugin::helper_argument(home),
            crate::computer_use::helper_argument(home),
            crate::remote_command::helper_argument(home),
        ];
        let endpoint = Endpoint {
            channel: uuid::Uuid::new_v4(),
            owner: std::process::id(),
            arguments: allowed.clone(),
        };
        let listener = pipe::server(endpoint.channel, true)?;
        let (stop, stopped) = oneshot::channel();
        let channel = endpoint.channel;
        tokio::spawn(serve(listener, channel, allowed, stopped));
        Ok(Self {
            endpoint: serde_json::to_string(&endpoint).map_err(|_| Error::Unavailable)?,
            stop: Mutex::new(Some(stop)),
        })
    }

    pub(crate) fn configure(&self, command: &mut tokio::process::Command) {
        command.env(HOST_ENV, &self.endpoint);
    }

    pub(crate) fn stop(&self) {
        if let Ok(mut stop) = self.stop.lock() {
            // A closed receiver means the worker already exited and released its jobs.
            if let Some(stop) = stop.take() {
                let _ = stop.send(());
            }
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.stop();
    }
}

fn helper_argument(argument: &str) -> bool {
    PREFIXES.iter().any(|prefix| {
        argument
            .strip_prefix(prefix)
            .is_some_and(|id| id.len() == 64 && id.bytes().all(|byte| byte.is_ascii_hexdigit()))
    })
}

/// CLI installations without a GUI host keep their normal standalone STDIO behavior.
pub(crate) fn handoff() -> Option<Result<()>> {
    let mut arguments = std::env::args().skip(1);
    let argument = arguments.next()?;
    // A GUI itself can have inherited an older host variable from a terminal. Never hand off twice.
    if !helper_argument(&argument) || arguments.next().as_deref() == Some(WORKER_ARGUMENT) {
        return None;
    }
    let endpoint = std::env::var_os(HOST_ENV)?;
    let endpoint: Endpoint = match serde_json::from_str(&endpoint.to_string_lossy()) {
        Ok(endpoint) => endpoint,
        Err(_) => return Some(Err(Error::Unavailable)),
    };
    // Terminals launched by Codex can inherit this variable. Other Homes must remain standalone.
    if !endpoint.arguments.contains(&argument) {
        return None;
    }
    Some(tauri::async_runtime::block_on(async move {
        let mut connection = pipe::connect(&endpoint).await?;
        let request = Request {
            argument,
            streams: native::standard_streams()?,
        };
        pipe::write(&mut connection, &request).await?;
        let accepted: bool = pipe::read(&mut connection).await?;
        if accepted {
            Ok(())
        } else {
            Err(Error::Unavailable)
        }
    }))
}

async fn serve(
    mut listener: tokio::net::windows::named_pipe::NamedPipeServer,
    channel: uuid::Uuid,
    allowed: [String; 3],
    mut stopped: oneshot::Receiver<()>,
) {
    let mut workers = Vec::<native::Worker>::new();
    loop {
        tokio::select! {
            _ = &mut stopped => break,
            connected = listener.connect() => if connected.is_err() { break; },
        }
        let next = match pipe::server(channel, false) {
            Ok(next) => next,
            Err(_) => break,
        };
        let mut connection = std::mem::replace(&mut listener, next);
        // Each startup is bounded. The private pipe never carries MCP messages or user commands.
        let result = tokio::select! {
            _ = &mut stopped => break,
            result = accept(&mut connection, &allowed) => result,
        };
        workers.retain(native::Worker::alive);
        match result {
            Ok(worker) => {
                if pipe::write(&mut connection, &true).await.is_ok() {
                    workers.push(worker);
                }
                // Lost acknowledgements discard the worker; launchers never replay an uncertain handoff.
            }
            Err(_) => {
                // A rejected or disconnected launcher has no worker to retain; its reply is best effort.
                let _ = pipe::write(&mut connection, &false).await;
            }
        }
    }
    // Dropping each job stops its worker and descendants, including on unexpected host teardown.
}

async fn accept(
    connection: &mut tokio::net::windows::named_pipe::NamedPipeServer,
    allowed: &[String; 3],
) -> Result<native::Worker> {
    let peer = pipe::client(connection)?;
    let request: Request = pipe::read(connection).await?;
    if !allowed.contains(&request.argument) {
        return Err(Error::Unavailable);
    }
    tokio::task::spawn_blocking(move || native::spawn(&peer, &request))
        .await
        .map_err(|_| Error::Unavailable)?
}

#[cfg(debug_assertions)]
pub(crate) use probe::run as run_probe;
