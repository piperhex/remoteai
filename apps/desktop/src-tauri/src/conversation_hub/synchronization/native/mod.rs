//! Native binary synchronization between authorized desktop bundle handles.
pub(crate) mod bridge;
#[cfg(test)]
pub(crate) mod fixture;
#[cfg(test)]
mod tests;
mod transfer;
mod wire;

use crate::{
    native_rtc::{bulk::Target, stream::Port},
    remote_chat::crypto::BulkContext,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        Arc,
    },
    time::Instant,
};
use tauri::{Manager, Webview};
use tokio::sync::{Mutex, Notify};

#[derive(Debug, Clone, Copy, thiserror::Error)]
pub(super) enum Error {
    #[error("invalid synchronization record")]
    Invalid,
    #[error("synchronization unavailable")]
    Unavailable,
    #[error("synchronization cancelled")]
    Cancelled,
}
type Result<T> = std::result::Result<T, Error>;
const MAX_JOBS: usize = 16;
const COMPLETE: u8 = 1;
const INVALID: u8 = 2;
const FAILED: u8 = 3;

#[derive(Default)]
pub(crate) struct State(Mutex<HashMap<String, Arc<Job>>>);

struct Job {
    written: AtomicU64,
    elapsed_ms: AtomicU64,
    status: AtomicU8,
    cancelled: AtomicBool,
    interrupt: Notify,
    finished: Notify,
    started: Instant,
}

impl Job {
    fn finish(&self, result: Result<()>) {
        self.elapsed_ms
            .store(self.started.elapsed().as_millis() as u64, Ordering::Relaxed);
        self.status.store(
            match result {
                Ok(()) => COMPLETE,
                Err(Error::Invalid) => INVALID,
                Err(_) => FAILED,
            },
            Ordering::Release,
        );
        self.finished.notify_waiters();
    }
    fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(Error::Cancelled)
        } else {
            Ok(())
        }
    }
    async fn record(&self, port: &mut Port) -> Result<bytes::Bytes> {
        self.check()?;
        tokio::select! {
            record = port.receive() => record.map_err(|_| Error::Unavailable),
            _ = self.interrupt.notified() => Err(Error::Cancelled),
        }
    }
}

impl State {
    async fn register(&self, offset: u64) -> Result<(String, Arc<Job>)> {
        let mut jobs = self.0.lock().await;
        jobs.retain(|_, job| {
            job.status.load(Ordering::Acquire) == 0 || job.started.elapsed().as_secs() < 600
        });
        if jobs.len() >= MAX_JOBS {
            return Err(Error::Unavailable);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let job = Arc::new(Job {
            written: AtomicU64::new(offset),
            elapsed_ms: AtomicU64::new(0),
            status: AtomicU8::new(0),
            cancelled: AtomicBool::new(false),
            interrupt: Notify::new(),
            finished: Notify::new(),
            started: Instant::now(),
        });
        jobs.insert(id.clone(), job.clone());
        Ok((id, job))
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Direction {
    Send,
    Receive,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Start {
    bundle: String,
    direction: Direction,
    transfer_id: String,
    epoch: String,
    size: u64,
    sha256: String,
    offset: u64,
    cipher: String,
    target: Target,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    written: u64,
    finished: bool,
    error: Option<&'static str>,
    elapsed_ms: u128,
}

fn authorize(window: &Webview) -> std::result::Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(super::INVALID.into())
    }
}
fn boundary(error: Error) -> String {
    if matches!(error, Error::Invalid) {
        super::INVALID.into()
    } else {
        super::FAILED.into()
    }
}

async fn prepare(
    app: &tauri::AppHandle,
    request: &Start,
) -> Result<(wire::Cipher, Option<super::binary::Reader>)> {
    let id = uuid::Uuid::parse_str(&request.transfer_id).map_err(|_| Error::Invalid)?;
    uuid::Uuid::parse_str(&request.epoch).map_err(|_| Error::Invalid)?;
    if request.offset > request.size || request.size == 0 {
        return Err(Error::Invalid);
    }
    let crypto = app
        .state::<crate::remote_chat::crypto::State>()
        .inner()
        .clone();
    let (handle, bundle, hash) = (
        request.cipher.clone(),
        request.bundle.clone(),
        request.sha256.clone(),
    );
    let context = BulkContext {
        transfer_id: request.transfer_id.clone(),
        manifest_id: hash.clone(),
        epoch: request.epoch.clone(),
    };
    let (offset, size, direction) = (request.offset, request.size, request.direction);
    tauri::async_runtime::spawn_blocking(move || {
        let reader = match direction {
            Direction::Send => {
                let reader = super::binary::reader(&bundle, offset).map_err(|_| Error::Invalid)?;
                if reader.size != size || reader.sha256 != hash {
                    return Err(Error::Invalid);
                }
                Some(reader)
            }
            Direction::Receive => {
                super::binary::destination(&bundle, offset, size, &hash)
                    .map_err(|_| Error::Invalid)?;
                None
            }
        };
        let keys = crypto
            .session(&handle)
            .map_err(|_| Error::Invalid)?
            .lock()
            .map_err(|_| Error::Unavailable)?
            .bulk_keys(context)
            .map_err(|_| Error::Invalid)?;
        Ok((
            wire::Cipher::new(id, keys.send_key, keys.receive_key)?,
            reader,
        ))
    })
    .await
    .map_err(|_| Error::Unavailable)?
}

#[tauri::command]
pub(crate) async fn codex_conversation_sync_native_start(
    app: tauri::AppHandle,
    window: Webview,
    request: Start,
) -> std::result::Result<String, String> {
    authorize(&window)?;
    let (cipher, reader) = prepare(&app, &request).await.map_err(boundary)?;
    let transfer_id =
        uuid::Uuid::parse_str(&request.transfer_id).map_err(|_| super::INVALID.to_owned())?;
    let port = app
        .state::<crate::native_rtc::State>()
        .stream(&request.target, transfer_id)
        .await
        .map_err(|_| super::FAILED.to_owned())?;
    launch(
        &app.state::<State>(),
        request,
        Prepared {
            port,
            cipher,
            reader,
        },
    )
    .await
    .map_err(boundary)
}

struct Prepared {
    port: Port,
    cipher: wire::Cipher,
    reader: Option<super::binary::Reader>,
}

async fn launch(state: &State, request: Start, prepared: Prepared) -> Result<String> {
    let Prepared {
        port,
        cipher,
        reader,
    } = prepared;
    let (id, job) = match state.register(request.offset).await {
        Ok(registered) => registered,
        Err(error) => {
            port.close().await;
            return Err(error);
        }
    };
    tauri::async_runtime::spawn(async move {
        let mut port = port;
        let context = transfer::Context {
            request: &request,
            job: &job,
        };
        let result = transfer::run(context, &mut port, cipher, reader).await;
        port.close().await;
        job.finish(result);
    });
    Ok(id)
}

#[tauri::command]
pub(crate) async fn codex_conversation_sync_native_poll(
    window: Webview,
    state: tauri::State<'_, State>,
    id: String,
) -> std::result::Result<Progress, String> {
    authorize(&window)?;
    let jobs = state.0.lock().await;
    let job = jobs.get(&id).ok_or_else(|| super::INVALID.to_owned())?;
    let status = job.status.load(Ordering::Acquire);
    Ok(Progress {
        written: job.written.load(Ordering::Acquire),
        finished: status != 0,
        error: match status {
            INVALID => Some(super::INVALID),
            FAILED => Some(super::FAILED),
            _ => None,
        },
        elapsed_ms: if status == 0 {
            job.started.elapsed().as_millis()
        } else {
            u128::from(job.elapsed_ms.load(Ordering::Relaxed))
        },
    })
}

#[tauri::command]
pub(crate) async fn codex_conversation_sync_native_close(
    window: Webview,
    state: tauri::State<'_, State>,
    id: String,
) -> std::result::Result<(), String> {
    authorize(&window)?;
    let job = state.0.lock().await.get(&id).cloned();
    if let Some(job) = job {
        job.cancelled.store(true, Ordering::Release);
        job.interrupt.notify_one();
        // A blocking disk write must finish before pause/close can return and a resumed job can start.
        let finished = job.finished.notified();
        if job.status.load(Ordering::Acquire) == 0 {
            tokio::time::timeout(std::time::Duration::from_secs(30), finished)
                .await
                .map_err(|_| super::FAILED.to_owned())?;
        }
        state.0.lock().await.remove(&id);
    }
    Ok(())
}
