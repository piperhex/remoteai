use super::{
    authorize,
    session::{CryptoError, Open},
    tcp_codec::{Codec, Operation, Output, MAX_BATCH_BYTES},
    State, ERROR, IDLE_TTL, MAX_BATCH, MAX_SESSIONS,
};
use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::Instant,
};
use tauri::Webview;

pub(super) struct Entry {
    codec: Arc<Mutex<Codec>>,
    touched: Instant,
}

#[derive(Serialize)]
pub(crate) struct Opened {
    id: String,
    output: Output,
}

#[tauri::command]
pub(crate) async fn remote_chat_tcp_crypto_open(
    window: Webview,
    state: tauri::State<'_, State>,
    request: Open,
) -> Result<Opened, String> {
    authorize(&window)?;
    let state = state.inner().clone();
    let permit = state
        .workers
        .clone()
        .try_acquire_owned()
        .map_err(|_| ERROR.to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let codec = Codec::new(request)?;
        let output = codec.hello();
        let mut sessions = state.tcp.lock().map_err(|_| CryptoError)?;
        sessions.retain(|_, entry| entry.touched.elapsed() < IDLE_TTL);
        if sessions.len() >= MAX_SESSIONS {
            return Err(CryptoError);
        }
        let id = uuid::Uuid::new_v4().to_string();
        sessions.insert(
            id.clone(),
            Entry {
                codec: Arc::new(Mutex::new(codec)),
                touched: Instant::now(),
            },
        );
        Ok(Opened { id, output })
    })
    .await
    .map_err(|_| ERROR.to_owned())?
    .map_err(|_| ERROR.to_owned())
}

#[tauri::command]
pub(crate) async fn remote_chat_tcp_crypto_batch(
    window: Webview,
    state: tauri::State<'_, State>,
    id: String,
    operations: Vec<Operation>,
) -> Result<Output, String> {
    authorize(&window)?;
    if operations.is_empty()
        || operations.len() > MAX_BATCH
        || operations.iter().map(Operation::bytes).sum::<usize>() > MAX_BATCH_BYTES
    {
        return Err(ERROR.into());
    }
    let state = state.inner().clone();
    let permit = state
        .workers
        .clone()
        .try_acquire_owned()
        .map_err(|_| ERROR.to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let codec = {
            let mut sessions = state.tcp.lock().map_err(|_| CryptoError)?;
            let entry = sessions.get_mut(&id).ok_or(CryptoError)?;
            entry.touched = Instant::now();
            entry.codec.clone()
        };
        let output = codec.lock().map_err(|_| CryptoError)?.batch(operations);
        output
    })
    .await
    .map_err(|_| ERROR.to_owned())?
    .map_err(|_| ERROR.to_owned())
}

#[tauri::command]
pub(crate) async fn remote_chat_tcp_crypto_close(
    window: Webview,
    state: tauri::State<'_, State>,
    id: String,
) -> Result<(), String> {
    authorize(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.tcp.lock().map_err(|_| CryptoError)?.remove(&id);
        Ok::<_, CryptoError>(())
    })
    .await
    .map_err(|_| ERROR.to_owned())?
    .map_err(|_| ERROR.to_owned())
}
