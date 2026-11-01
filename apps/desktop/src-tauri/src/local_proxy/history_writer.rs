//! Bounded invalidation queue: bodies stay in the existing history registry.
//! Overflow coalesces into a rescan, never a synchronous database fallback.
use std::{
    collections::VecDeque,
    sync::{Arc, Condvar, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const MAX_PENDING: usize = 256;
const MAX_ACTIVE_REQUESTS: usize = 256;
const MAX_KEY_BYTES: usize = 64 * 1024;
const RETRY_DELAY: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Key {
    pub session: String,
    pub request: Option<u64>,
}

pub(super) enum Work {
    Save(Key),
    Rescan,
}

#[derive(Debug, thiserror::Error)]
pub(super) enum WriterError {
    #[error("history writer unavailable")]
    Unavailable,
    #[error("history writer drain timed out")]
    Timeout,
}

#[derive(Default)]
struct State {
    pending: VecDeque<Key>,
    key_bytes: usize,
    rescan: bool,
    busy: bool,
    closing: bool,
    stopped: bool,
    failed: bool,
    active: usize,
}

#[derive(Default)]
struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}

pub(super) struct Writer {
    shared: Arc<Shared>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

/// Covers the entire tracked HTTP request, including its final guard write.
pub(super) struct RequestLease(Arc<Shared>);

impl Drop for RequestLease {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.active -= 1;
            self.0.changed.notify_all();
        }
    }
}

impl Writer {
    pub fn start<E: Send + 'static>(
        save: impl Fn(&Work) -> Result<(), E> + Send + 'static,
        report: impl Fn(Option<&E>) + Send + 'static,
    ) -> std::io::Result<Self> {
        let shared = Arc::new(Shared::default());
        let worker_shared = Arc::clone(&shared);
        let worker = thread::Builder::new()
            .name("proxy-history-writer".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run(&worker_shared, save, &report);
                }));
                if result.is_err() {
                    report(None);
                    if let Ok(mut state) = worker_shared.state.lock() {
                        state.failed = true;
                        state.stopped = true;
                        worker_shared.changed.notify_all();
                    }
                }
            })?;
        Ok(Self {
            shared,
            worker: Mutex::new(Some(worker)),
        })
    }

    pub fn enter(&self) -> Result<RequestLease, WriterError> {
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| WriterError::Unavailable)?;
        // Pending bodies live in the existing registry, so admission must also
        // stop on saturation; bounding only the notification queue is insufficient.
        if state.closing
            || state.stopped
            || state.failed
            || state.rescan
            || state.pending.len() == MAX_PENDING
            || state.key_bytes == MAX_KEY_BYTES
            || state.active == MAX_ACTIVE_REQUESTS
        {
            return Err(WriterError::Unavailable);
        }
        state.active += 1;
        Ok(RequestLease(Arc::clone(&self.shared)))
    }

    /// A pre-upstream retention barrier, never called by a stream reader.
    pub fn flush(&self, timeout: Duration) -> Result<(), WriterError> {
        let deadline = Instant::now() + timeout;
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| WriterError::Unavailable)?;
        while state.busy || !state.pending.is_empty() || state.rescan {
            if state.stopped {
                return Err(WriterError::Unavailable);
            }
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or(WriterError::Timeout)?;
            state = self
                .shared
                .changed
                .wait_timeout(state, remaining)
                .map_err(|_| WriterError::Unavailable)?
                .0;
        }
        if state.failed {
            Err(WriterError::Unavailable)
        } else {
            Ok(())
        }
    }

    /// Only holds a short queue lock. No body cloning, I/O, logging, or capacity wait.
    pub fn enqueue(&self, session: &str, request: Option<u64>) -> Result<(), WriterError> {
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| WriterError::Unavailable)?;
        if state.stopped {
            return Err(WriterError::Unavailable);
        }
        if state
            .pending
            .iter()
            .any(|key| key.session == session && key.request == request)
        {
            return Ok(());
        }
        if state.pending.len() == MAX_PENDING || session.len() > MAX_KEY_BYTES - state.key_bytes {
            state.rescan = true;
        } else {
            state.key_bytes += session.len();
            state.pending.push_back(Key {
                session: session.into(),
                request,
            });
        }
        self.shared.changed.notify_all();
        Ok(())
    }

    /// Reject new tracked requests, wait for existing producers and durable writes.
    /// On timeout reopen admission and retain pending work for retry; callers must not exit.
    pub fn close(&self, timeout: Duration) -> Result<(), WriterError> {
        let deadline = Instant::now() + timeout;
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| WriterError::Unavailable)?;
        state.closing = true;
        loop {
            if state.stopped {
                return if state.failed {
                    Err(WriterError::Unavailable)
                } else {
                    Ok(())
                };
            }
            if state.active == 0 && !state.busy && state.pending.is_empty() && !state.rescan {
                state.stopped = true;
                self.shared.changed.notify_all();
                break;
            }
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                state.closing = false;
                return Err(WriterError::Timeout);
            };
            state = self
                .shared
                .changed
                .wait_timeout(state, remaining)
                .map_err(|_| WriterError::Unavailable)?
                .0;
        }
        drop(state);
        if let Some(worker) = self
            .worker
            .lock()
            .map_err(|_| WriterError::Unavailable)?
            .take()
        {
            worker.join().map_err(|_| WriterError::Unavailable)?;
        }
        Ok(())
    }
}

fn next_work(shared: &Shared) -> Option<Work> {
    let mut state = shared.state.lock().ok()?;
    loop {
        if state.stopped {
            return None;
        }
        let work = if std::mem::take(&mut state.rescan) {
            Some(Work::Rescan)
        } else {
            state.pending.pop_front().map(|key| {
                state.key_bytes -= key.session.len();
                Work::Save(key)
            })
        };
        if let Some(work) = work {
            state.busy = true;
            return Some(work);
        }
        state = shared.changed.wait(state).ok()?;
    }
}

fn run<E>(shared: &Shared, save: impl Fn(&Work) -> Result<(), E>, report: impl Fn(Option<&E>)) {
    while let Some(work) = next_work(shared) {
        let result = save(&work);
        let Ok(mut state) = shared.state.lock() else {
            return;
        };
        let first_failure = result.is_err() && !state.failed;
        state.failed = result.is_err();
        state.rescan |= result.is_err();
        state.busy = false;
        shared.changed.notify_all();
        drop(state);
        if let Err(error) = result {
            if first_failure {
                report(Some(&error));
            }
            // One worker retries retained state; a failure cannot grow a retry queue.
            thread::sleep(RETRY_DELAY);
        }
    }
}

#[cfg(test)]
#[path = "tests/history_writer.rs"]
mod tests;
