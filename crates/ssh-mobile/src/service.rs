use crate::buffer::Buffer;
use csw_ssh_client::{Client, Command, Connect, Endpoint, Error, FileAction, Info, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

const MAX_SCOPES: usize = 8;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    Probe {
        endpoint: Endpoint,
    },
    Open {
        request: Connect,
    },
    List,
    Read {
        id: String,
        cursor: u64,
        token: Option<String>,
    },
    BinaryMode {
        id: String,
        token: String,
        enabled: bool,
    },
    Command {
        request: Command,
    },
    Files {
        id: String,
        request: FileAction,
    },
    Dispose,
}

struct Entry {
    info: Info,
    buffer: Arc<Mutex<Buffer>>,
    _permit: OwnedSemaphorePermit,
}

#[derive(Default)]
pub(crate) struct Service {
    scopes: Mutex<HashMap<(String, String), Arc<Scope>>>,
}

struct Scope {
    client: Arc<Client>,
    entries: Mutex<HashMap<String, Entry>>,
    slots: Arc<Semaphore>,
    closed: AtomicBool,
}

impl Default for Scope {
    fn default() -> Self {
        Self {
            client: Arc::default(),
            entries: Mutex::default(),
            closed: AtomicBool::new(false),
            slots: Arc::new(Semaphore::new(csw_ssh_client::MAX_SESSIONS)),
        }
    }
}

impl Service {
    pub(crate) async fn dispatch(
        &self,
        owner: &str,
        scope: &str,
        request: Request,
    ) -> Result<Value> {
        if owner.is_empty() || owner.len() > 128 || scope.is_empty() || scope.len() > 128 {
            return Err(Error::Invalid);
        }
        let key = (owner.to_owned(), scope.to_owned());
        if matches!(request, Request::Dispose) {
            let state = self.scopes.lock().map_err(|_| Error::Closed)?.remove(&key);
            if let Some(state) = state {
                state.dispose().await?;
            }
            return Ok(Value::Null);
        }
        let state = {
            let mut scopes = self.scopes.lock().map_err(|_| Error::Closed)?;
            if !scopes.contains_key(&key) && scopes.len() >= MAX_SCOPES {
                return Err(Error::Limit);
            }
            scopes.entry(key).or_default().clone()
        };
        state.dispatch(request).await
    }

    pub(crate) async fn reset(&self, owner: &str) -> Result<()> {
        let states = {
            let mut scopes = self.scopes.lock().map_err(|_| Error::Closed)?;
            let keys: Vec<_> = scopes
                .keys()
                .filter(|(value, _)| value == owner)
                .cloned()
                .collect();
            keys.into_iter()
                .filter_map(|key| scopes.remove(&key))
                .collect::<Vec<_>>()
        };
        for state in states {
            state.dispose().await?;
        }
        Ok(())
    }
}

impl Scope {
    async fn dispatch(self: &Arc<Self>, request: Request) -> Result<Value> {
        if self.closed.load(Ordering::Acquire) {
            return Err(Error::Closed);
        }
        match request {
            Request::Probe { endpoint } => Ok(json!(csw_ssh_client::probe(endpoint).await?)),
            Request::Open { request } => self.open(request).await,
            Request::List => self.list(),
            Request::Read { id, cursor, token } => self.read(&id, cursor, token.as_deref()).await,
            Request::BinaryMode { id, token, enabled } => {
                self.binary_mode(id, &token, enabled).await
            }
            Request::Command { request } => self.command(request).await,
            Request::Files { id, request } => {
                self.buffer(&id)?;
                Ok(json!(self.client.files(&id, request).await?))
            }
            Request::Dispose => Err(Error::Closed),
        }
    }

    async fn open(&self, request: Connect) -> Result<Value> {
        // A phone has no desktop X server. Never launch or probe local display programs.
        if request.x11.is_some() {
            return Err(Error::X11Unavailable);
        }
        let permit = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Limit)?;
        let buffer = Arc::new(Mutex::new(Buffer::default()));
        let output = buffer.clone();
        let info = self
            .client
            .open(
                request,
                Arc::new(move |event| {
                    let Ok(mut buffer) = output.lock() else {
                        return false;
                    };
                    buffer.push(event);
                    true
                }),
            )
            .await?;
        if self.closed.load(Ordering::Acquire) {
            self.client.command(Command::Close { id: info.id }).await?;
            return Err(Error::Closed);
        }
        let reply = json!(info);
        self.entries.lock().map_err(|_| Error::Closed)?.insert(
            info.id.clone(),
            Entry {
                info,
                buffer,
                _permit: permit,
            },
        );
        Ok(reply)
    }

    fn buffer(&self, id: &str) -> Result<Arc<Mutex<Buffer>>> {
        self.entries
            .lock()
            .map_err(|_| Error::Closed)?
            .get(id)
            .map(|entry| entry.buffer.clone())
            .ok_or(Error::Closed)
    }

    fn list(&self) -> Result<Value> {
        let entries = self.entries.lock().map_err(|_| Error::Closed)?;
        entries
            .values()
            .map(|entry| {
                let mut info = json!(entry.info);
                info["exited"] = json!(entry.buffer.lock().map_err(|_| Error::Closed)?.exited);
                Ok(info)
            })
            .collect::<Result<Vec<_>>>()
            .map(|values| json!(values))
    }

    async fn read(&self, id: &str, cursor: u64, token: Option<&str>) -> Result<Value> {
        let Ok(buffer) = self.buffer(id) else {
            return Ok(
                json!({ "found": false, "events": [], "cursor": cursor, "truncated": false }),
            );
        };
        let (reply, bytes, exited) = {
            let mut buffer = buffer.lock().map_err(|_| Error::Closed)?;
            (
                buffer.read(cursor),
                buffer.acknowledge(cursor, token),
                buffer.exited,
            )
        };
        if bytes > 0 && !exited {
            self.client
                .command(Command::OutputAck {
                    id: id.to_owned(),
                    bytes,
                })
                .await?;
        }
        Ok(json!(reply))
    }

    async fn binary_mode(&self, id: String, token: &str, enabled: bool) -> Result<Value> {
        let buffer = self.buffer(&id)?;
        let changed = buffer
            .lock()
            .map_err(|_| Error::Closed)?
            .binary_mode(token, enabled)?;
        if changed {
            self.client
                .command(Command::OutputFlow { id, enabled })
                .await?;
        }
        Ok(Value::Null)
    }

    async fn command(&self, request: Command) -> Result<Value> {
        let closing = if let Command::Close { id } = &request {
            Some(id.clone())
        } else {
            None
        };
        self.client.command(request).await?;
        if let Some(id) = closing {
            self.entries.lock().map_err(|_| Error::Closed)?.remove(&id);
        }
        Ok(Value::Null)
    }

    async fn dispose(&self) -> Result<()> {
        self.closed.store(true, Ordering::Release);
        let entries = std::mem::take(&mut *self.entries.lock().map_err(|_| Error::Closed)?);
        let mut result = Ok(());
        for (id, _) in entries {
            if let Err(error) = self.client.command(Command::Close { id }).await {
                result = Err(error);
            }
        }
        result
    }
}
