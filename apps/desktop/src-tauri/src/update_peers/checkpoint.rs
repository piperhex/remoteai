//! A bounded writer owns all partial-package I/O, including idle and cancellation checkpoints.
//! Only the existing whole-package verifier can publish the bytes returned by finish.
#[path = "checkpoint/platform.rs"]
mod platform;
#[path = "checkpoint/state.rs"]
mod state;
#[path = "checkpoint/worker.rs"]
mod worker;

use super::{Error, Result};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::{oneshot, OwnedSemaphorePermit, Semaphore};
use worker::{Command, Control};

pub(super) struct Checkpoint {
    control: Arc<Control>,
    capacity: Arc<Semaphore>,
}

impl Checkpoint {
    pub async fn open(
        directory: PathBuf,
        id: String,
        size: usize,
    ) -> Result<(Arc<Self>, Vec<bool>)> {
        tokio::task::spawn_blocking(move || {
            let (control, done) = worker::open(directory, id, size)?;
            // Construct the drop guard before crossing await: a cancelled open must close its writer too.
            Ok((
                Arc::new(Self {
                    control,
                    capacity: Arc::new(Semaphore::new(1)),
                }),
                done,
            ))
        })
        .await
        .map_err(|_| Error::Unavailable)?
    }

    async fn permit(&self) -> Result<OwnedSemaphorePermit> {
        self.capacity
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Unavailable)
    }

    /// Acknowledges a complete write, not durability. Only an on-disk ledger is resumable.
    pub async fn write(self: &Arc<Self>, index: usize, bytes: Vec<u8>) -> Result<()> {
        let permit = self.permit().await?;
        let (reply, result) = oneshot::channel();
        self.control.send(Command::Write {
            index,
            bytes,
            reply,
            _permit: permit,
        })?;
        result.await.map_err(|_| Error::Unavailable)?
    }

    /// Used by explicit pause/error boundaries; cancellation also closes the writer through Drop.
    pub async fn flush(&self) -> Result<()> {
        let permit = self.permit().await?;
        let (reply, result) = oneshot::channel();
        self.control.send(Command::Flush {
            reply,
            _permit: permit,
        })?;
        result.await.map_err(|_| Error::Unavailable)?
    }

    pub async fn finish(self: Arc<Self>, size: usize) -> Result<Vec<u8>> {
        let permit = self.permit().await?;
        let (reply, result) = oneshot::channel();
        self.control.send(Command::Finish {
            size,
            reply,
            _permit: permit,
        })?;
        result.await.map_err(|_| Error::Unavailable)?
    }
}

impl Drop for Checkpoint {
    fn drop(&mut self) {
        // Nonblocking: an aborted download still flushes on its existing writer thread.
        self.control.close();
    }
}

/// Called only from the application's blocking exit worker. Prevents new opens and joins writers.
pub(crate) fn shutdown() {
    worker::shutdown();
}

#[cfg(test)]
#[path = "checkpoint/tests.rs"]
mod tests;
