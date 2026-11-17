//! Native chat cryptography. Blocking workers own key derivation, compression and AEAD.
mod session;
mod tcp_codec;
pub(crate) mod tcp_commands;
#[cfg(test)]
mod tests;

use crate::native_rtc::bulk::Target;
use serde::{Deserialize, Serialize};
pub(crate) use session::BulkContext;
use session::{BulkKeys, CryptoError, Open, Session};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, Webview};
use tokio::sync::Semaphore;

const MAX_SESSIONS: usize = 128;
const MAX_BATCH: usize = 32;
const IDLE_TTL: Duration = Duration::from_secs(2 * 60 * 60);
const ERROR: &str = "CHAT_PACKET_CODEC";

struct Entry {
    session: Arc<Mutex<Session>>,
    touched: Instant,
}

#[derive(Clone)]
pub(crate) struct State {
    sessions: Arc<Mutex<HashMap<String, Entry>>>,
    tcp: Arc<Mutex<HashMap<String, tcp_commands::Entry>>>,
    workers: Arc<Semaphore>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            sessions: Arc::default(),
            tcp: Arc::default(),
            workers: Arc::new(Semaphore::new(64)),
        }
    }
}

impl State {
    pub(crate) fn session(&self, id: &str) -> Result<Arc<Mutex<Session>>, CryptoError> {
        let mut sessions = self.sessions.lock().map_err(|_| CryptoError)?;
        let entry = sessions.get_mut(id).ok_or(CryptoError)?;
        entry.touched = Instant::now();
        Ok(entry.session.clone())
    }

    fn open(&self, request: Open) -> Result<String, CryptoError> {
        let session = Session::open(request)?;
        let mut sessions = self.sessions.lock().map_err(|_| CryptoError)?;
        sessions.retain(|_, entry| entry.touched.elapsed() < IDLE_TTL);
        if sessions.len() >= MAX_SESSIONS {
            return Err(CryptoError);
        }
        let id = uuid::Uuid::new_v4().to_string();
        sessions.insert(
            id.clone(),
            Entry {
                session: Arc::new(Mutex::new(session)),
                touched: Instant::now(),
            },
        );
        Ok(id)
    }
}

fn authorize(window: &Webview) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(ERROR.into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyPair {
    secret: Vec<u8>,
    public_key: String,
}

#[tauri::command]
pub(crate) async fn remote_chat_crypto_keypair(window: Webview) -> Result<KeyPair, String> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(|| {
        let secret = zeroize::Zeroizing::new(rand::random::<[u8; 32]>());
        KeyPair {
            public_key: hex::encode(x25519_dalek::x25519(
                *secret,
                x25519_dalek::X25519_BASEPOINT_BYTES,
            )),
            secret: secret.to_vec(),
        }
    })
    .await
    .map_err(|_| ERROR.into())
}

#[tauri::command]
pub(crate) async fn remote_chat_crypto_open(
    window: Webview,
    state: tauri::State<'_, State>,
    request: Open,
) -> Result<String, String> {
    authorize(&window)?;
    let state = state.inner().clone();
    let permit = state
        .workers
        .clone()
        .try_acquire_owned()
        .map_err(|_| ERROR.to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        state.open(request)
    })
    .await
    .map_err(|_| ERROR.to_owned())?
    .map_err(|_| ERROR.to_owned())
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Operation {
    Encrypt {
        text: String,
        compress: bool,
    },
    Decrypt {
        payload: String,
    },
    Send {
        text: String,
        compress: bool,
        target: ChatTarget,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ChatTarget {
    peer: String,
    channel: String,
    envelopes: u8,
}

struct PreparedBatch {
    replies: Vec<Option<String>>,
    sends: Vec<(Target, String)>,
}

fn batch(
    state: &State,
    id: &str,
    operations: Vec<Operation>,
) -> Result<PreparedBatch, CryptoError> {
    if operations.is_empty() || operations.len() > MAX_BATCH {
        return Err(CryptoError);
    }
    let session = state.session(id)?;
    let mut session = session.lock().map_err(|_| CryptoError)?;
    let mut batch = PreparedBatch {
        replies: Vec::with_capacity(operations.len()),
        sends: Vec::new(),
    };
    for operation in operations {
        batch.replies.push(match operation {
            Operation::Encrypt { text, compress } => Some(session.encrypt(&text, compress)?),
            Operation::Decrypt { payload } => session.decrypt(&payload)?,
            Operation::Send {
                text,
                compress,
                target,
            } => {
                if target.envelopes > 4 {
                    return Err(CryptoError);
                }
                let mut payload = session.encrypt(&text, compress)?;
                for _ in 0..target.envelopes {
                    payload = serde_json::to_string(&("data", payload)).map_err(|_| CryptoError)?;
                }
                batch.sends.push((
                    Target {
                        peer: target.peer,
                        channel: target.channel,
                    },
                    payload,
                ));
                None
            }
        });
    }
    Ok(batch)
}

#[tauri::command]
pub(crate) async fn remote_chat_crypto_batch(
    window: Webview,
    app: tauri::AppHandle,
    id: String,
    operations: Vec<Operation>,
) -> Result<Vec<Option<String>>, String> {
    authorize(&window)?;
    if operations.is_empty()
        || operations.len() > MAX_BATCH
        || operations.iter().any(|operation| match operation {
            Operation::Encrypt { text, .. } => {
                text.len() > csw_chat_connectivity::packet_codec::MAX_PLAIN_BYTES
            }
            Operation::Send { text, target, .. } => {
                text.len() > csw_chat_connectivity::packet_codec::MAX_PLAIN_BYTES
                    || target.envelopes > 4
                    || target.peer.len() > 128
                    || target.channel.len() > 128
            }
            Operation::Decrypt { payload } => payload.len() > session::MAX_PACKET_BYTES * 2,
        })
    {
        return Err(ERROR.into());
    }
    let state = app.state::<State>().inner().clone();
    let rtc = app.state::<crate::native_rtc::State>();
    let _permit = state
        .workers
        .clone()
        .try_acquire_owned()
        .map_err(|_| ERROR.to_owned())?;
    let prepared = tauri::async_runtime::spawn_blocking(move || batch(&state, &id, operations))
        .await
        .map_err(|_| ERROR.to_owned())?
        .map_err(|_| ERROR.to_owned())?;
    for (target, payload) in prepared.sends {
        rtc.send_chat(&target, payload)
            .await
            .map_err(|_| ERROR.to_owned())?;
    }
    Ok(prepared.replies)
}

#[tauri::command]
pub(crate) async fn remote_chat_crypto_bulk_keys(
    window: Webview,
    state: tauri::State<'_, State>,
    id: String,
    context: BulkContext,
) -> Result<BulkKeys, String> {
    authorize(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state
            .session(&id)?
            .lock()
            .map_err(|_| CryptoError)?
            .bulk_keys(context)
    })
    .await
    .map_err(|_| ERROR.to_owned())?
    .map_err(|_| ERROR.to_owned())
}

#[tauri::command]
pub(crate) async fn remote_chat_crypto_close(
    window: Webview,
    state: tauri::State<'_, State>,
    id: String,
) -> Result<(), String> {
    authorize(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.sessions.lock().map_err(|_| CryptoError)?.remove(&id);
        Ok::<_, CryptoError>(())
    })
    .await
    .map_err(|_| ERROR.to_owned())?
    .map_err(|_| ERROR.to_owned())
}
