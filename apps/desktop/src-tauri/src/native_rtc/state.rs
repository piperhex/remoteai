use super::{model::*, peer::Peer};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

struct Entry {
    owner: String,
    peer: Arc<Peer>,
    touched: AtomicU64,
    _slot: OwnedSemaphorePermit,
}

pub(super) struct Registry {
    started: Instant,
    entries: Mutex<HashMap<String, Arc<Entry>>>,
    slots: Arc<Semaphore>,
}

#[derive(Clone)]
pub(crate) struct State(Arc<Registry>);

impl Default for State {
    fn default() -> Self {
        Self(Arc::new(Registry {
            started: Instant::now(),
            entries: Mutex::new(HashMap::new()),
            slots: Arc::new(Semaphore::new(MAX_PEERS)),
        }))
    }
}

impl State {
    pub(super) async fn open(&self, owner: &str, config: Configuration) -> Result<String> {
        let slot = self
            .0
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Capacity)?;
        let peer = Peer::new(config).await?;
        let id = uuid::Uuid::new_v4().to_string();
        self.0.entries.lock().await.insert(
            id.clone(),
            Arc::new(Entry {
                owner: owner.into(),
                peer,
                touched: AtomicU64::new(self.0.started.elapsed().as_secs()),
                _slot: slot,
            }),
        );
        let state = self.clone();
        let handle = id.clone();
        tauri::async_runtime::spawn(async move {
            state.reap(handle).await;
        });
        Ok(id)
    }

    pub(crate) async fn get(&self, owner: &str, id: &str) -> Result<Arc<Peer>> {
        let entries = self.0.entries.lock().await;
        let entry = entries
            .get(id)
            .filter(|entry| entry.owner == owner)
            .ok_or(Error::Closed)?;
        entry
            .touched
            .store(self.0.started.elapsed().as_secs(), Ordering::Relaxed);
        Ok(entry.peer.clone())
    }

    pub(super) async fn close(&self, owner: &str, id: &str) -> Result<()> {
        let mut entries = self.0.entries.lock().await;
        if entries.get(id).is_some_and(|entry| entry.owner != owner) {
            return Err(Error::Closed);
        }
        let entry = entries.remove(id);
        drop(entries);
        if let Some(entry) = entry {
            entry.peer.close().await;
        }
        Ok(())
    }

    async fn reap(&self, id: String) {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let mut entries = self.0.entries.lock().await;
            let Some(entry) = entries.get(&id) else {
                return;
            };
            let idle = self
                .0
                .started
                .elapsed()
                .as_secs()
                .saturating_sub(entry.touched.load(Ordering::Relaxed));
            if !entry.peer.is_closed() && idle < 90 {
                continue;
            }
            let entry = entries.remove(&id);
            drop(entries);
            if let Some(entry) = entry {
                entry.peer.close().await;
            }
            return;
        }
    }
}
