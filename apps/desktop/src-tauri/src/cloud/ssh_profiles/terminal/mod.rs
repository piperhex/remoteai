//! Conversation-owned PTYs remain on the authenticated host for local, remote and Web callers.
mod buffer;
mod lifecycle;
mod opening;
mod protocol;
mod redact;

use super::{
    agent::{self, AgentSession, Target},
    ProfileError,
};
use buffer::Buffer;
use csw_ssh_client::{Client, Command, Event};
pub(crate) use lifecycle::close_agent_ssh_terminals;
pub(crate) use protocol::TerminalRequest;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use zeroize::Zeroizing;

const MAX_RETAINED_TERMINALS: usize = 32;

#[derive(Debug, thiserror::Error)]
pub(crate) enum TerminalError {
    #[error(transparent)]
    Profile(#[from] ProfileError),
    #[error(transparent)]
    Ssh(#[from] csw_ssh_client::Error),
}
type Result<T> = std::result::Result<T, TerminalError>;

struct Terminal {
    thread_id: String,
    owner: Arc<AgentSession>,
    remote_id: String,
    buffer: Arc<Buffer>,
    password: Zeroizing<Option<String>>,
    input: Mutex<()>,
    _permit: OwnedSemaphorePermit,
}

struct Registry {
    entries: Mutex<HashMap<String, Arc<Terminal>>>,
    slots: Arc<Semaphore>,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            slots: Arc::new(Semaphore::new(MAX_RETAINED_TERMINALS)),
        }
    }
}

fn registry<R: Runtime>(app: &AppHandle<R>) -> Arc<Registry> {
    app.manage(Arc::new(Registry::default()));
    app.state::<Arc<Registry>>().inner().clone()
}

async fn check<R: Runtime>(app: &AppHandle<R>, owner: &Arc<AgentSession>) -> Result<()> {
    let (app, owner) = (app.clone(), owner.clone());
    tauri::async_runtime::spawn_blocking(move || owner.check(&app))
        .await
        .map_err(|_| ProfileError::Unavailable)??;
    Ok(())
}

async fn prepare<R: Runtime>(
    app: &AppHandle<R>,
    target: Target,
) -> Result<(Arc<AgentSession>, csw_ssh_client::Connect)> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let owner = agent::session(&app)?;
        let (request, cached) = owner.prepare(&app, &target)?;
        if cached {
            owner.refresh_later(&app, Some(target));
        }
        Ok((owner, request))
    })
    .await
    .map_err(|_| ProfileError::Unavailable)?
}

async fn find<R: Runtime>(app: &AppHandle<R>, thread: &str, id: &str) -> Result<Arc<Terminal>> {
    let state = registry(app);
    let entry = state
        .entries
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or(csw_ssh_client::Error::Closed)?;
    if entry.thread_id != thread {
        return Err(csw_ssh_client::Error::Closed.into());
    }
    authorize(app, id, &entry).await?;
    entry.buffer.touch()?;
    Ok(entry)
}

pub(crate) async fn agent_ssh_terminal<R: Runtime>(
    app: AppHandle<R>,
    request: TerminalRequest,
) -> Result<Value> {
    request.validate()?;
    if let TerminalRequest::Open(args) = request {
        return opening::open(&app, args).await;
    }
    let (thread, id) = request.owner();
    let id = id.ok_or(ProfileError::Invalid)?.to_owned();
    let entry = find(&app, thread, &id).await?;
    let result = operate(&app, request, &entry, &id).await?;
    authorize(&app, &id, &entry).await?;
    Ok(result)
}

async fn operate<R: Runtime>(
    app: &AppHandle<R>,
    request: TerminalRequest,
    entry: &Terminal,
    id: &str,
) -> Result<Value> {
    let result = match request {
        TerminalRequest::Read(args) => {
            serde_json::to_value(entry.buffer.read(id, args.cursor, args.wait_ms).await?)
                .map_err(|_| ProfileError::Unavailable)?
        }
        TerminalRequest::Write(args) => {
            send(app, entry, args.text, args.sensitive).await?;
            json!({"sessionId":id, "sent":true})
        }
        TerminalRequest::Password(_) => {
            let password = entry
                .password
                .as_deref()
                .ok_or(ProfileError::CredentialsUnavailable)?;
            if !protocol::secret_line(password) {
                return Err(ProfileError::CredentialsUnavailable.into());
            }
            send(app, entry, format!("{password}\r"), true).await?;
            json!({"sessionId":id, "sent":true})
        }
        TerminalRequest::Resize(args) => {
            app.state::<Arc<Client>>()
                .command(Command::Resize {
                    id: entry.remote_id.clone(),
                    size: args.size,
                })
                .await?;
            json!({"sessionId":id, "resized":true})
        }
        TerminalRequest::Close(_) => {
            lifecycle::remove(app, id).await?;
            json!({"sessionId":id, "closed":true})
        }
        TerminalRequest::Open(_) => return Err(ProfileError::Invalid.into()),
    };
    Ok(result)
}

async fn send<R: Runtime>(
    app: &AppHandle<R>,
    entry: &Terminal,
    text: String,
    sensitive: bool,
) -> Result<()> {
    let text = Zeroizing::new(text);
    let _input = entry.input.lock().await;
    check(app, &entry.owner).await?;
    if sensitive {
        entry
            .buffer
            .protect(text.trim_end_matches(['\r', '\n']).as_bytes())?;
    }
    app.state::<Arc<Client>>()
        .command(Command::WriteBinary {
            id: entry.remote_id.clone(),
            data: text.as_bytes().to_vec(),
        })
        .await?;
    Ok(())
}

async fn authorize<R: Runtime>(app: &AppHandle<R>, id: &str, entry: &Terminal) -> Result<()> {
    if let Err(error) = check(app, &entry.owner).await {
        if let Err(cleanup) = lifecycle::remove(app, id).await {
            eprintln!("SSH agent terminal cleanup after login change: {cleanup}");
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
