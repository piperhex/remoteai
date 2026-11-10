use super::redact::Redactor;
use csw_ssh_client::{Error, Event};
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::sync::Notify;

const BUFFER_BYTES: usize = 256 * 1024;
const READ_BYTES: usize = 64 * 1024;

pub(super) struct Buffer {
    state: Mutex<State>,
    changed: Notify,
}

struct State {
    output: VecDeque<u8>,
    start: u64,
    closed: bool,
    exit_code: Option<u32>,
    touched: Instant,
    redactor: Redactor,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Output {
    pub(crate) session_id: String,
    pub(crate) output: String,
    pub(crate) cursor: u64,
    pub(crate) closed: bool,
    pub(crate) exit_code: Option<u32>,
    pub(crate) truncated: bool,
    pub(crate) has_more: bool,
    pub(crate) wait_timed_out: bool,
}

impl Default for Buffer {
    fn default() -> Self {
        Self {
            state: Mutex::new(State {
                output: VecDeque::new(),
                start: 0,
                closed: false,
                exit_code: None,
                touched: Instant::now(),
                redactor: Redactor::default(),
            }),
            changed: Notify::new(),
        }
    }
}

impl Buffer {
    pub(super) fn event(&self, event: Event) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        if state.closed {
            return false;
        }
        let data = match event {
            Event::Output { data } => state.redactor.push(&data, false),
            Event::Exit { code } => {
                state.closed = true;
                state.exit_code = code;
                state.redactor.push(&[], true)
            }
            Event::Error { .. } => {
                state.closed = true;
                state.redactor.push(&[], true)
            }
        };
        state.output.extend(data);
        if state.output.len() > BUFFER_BYTES {
            let excess = state.output.len() - BUFFER_BYTES;
            state.output.drain(..excess);
            state.start += excess as u64;
        }
        drop(state);
        self.changed.notify_waiters();
        true
    }

    pub(super) fn protect(&self, secret: &[u8]) -> Result<(), Error> {
        let mut state = self.state.lock().map_err(|_| Error::Closed)?;
        if !state.redactor.protect(secret) {
            return Err(Error::Invalid);
        }
        Ok(())
    }

    pub(super) fn touch(&self) -> Result<(), Error> {
        self.state.lock().map_err(|_| Error::Closed)?.touched = Instant::now();
        Ok(())
    }

    pub(super) fn expired(&self, idle: Duration) -> bool {
        self.state
            .lock()
            .map_or(true, |state| state.touched.elapsed() >= idle)
    }

    fn snapshot(&self, id: &str, cursor: u64) -> Result<Output, Error> {
        let state = self.state.lock().map_err(|_| Error::Closed)?;
        let end = state.start + state.output.len() as u64;
        if cursor > end {
            return Err(Error::Invalid);
        }
        let offset = cursor.saturating_sub(state.start) as usize;
        let bytes: Vec<_> = state
            .output
            .iter()
            .skip(offset)
            .take(READ_BYTES)
            .copied()
            .collect();
        let length = match std::str::from_utf8(&bytes) {
            Err(error)
                if error.error_len().is_none()
                    && (!state.closed || offset + bytes.len() < state.output.len()) =>
            {
                error.valid_up_to()
            }
            _ => bytes.len(),
        };
        let next = state.start + offset as u64 + length as u64;
        Ok(Output {
            session_id: id.to_owned(),
            output: String::from_utf8_lossy(&bytes[..length]).into_owned(),
            cursor: next,
            closed: state.closed,
            exit_code: state.exit_code,
            truncated: cursor < state.start,
            has_more: next < end,
            wait_timed_out: false,
        })
    }

    pub(super) async fn read(&self, id: &str, cursor: u64, wait_ms: u64) -> Result<Output, Error> {
        if wait_ms > 30_000 {
            return Err(Error::Invalid);
        }
        self.touch()?;
        let deadline = tokio::time::Instant::now() + Duration::from_millis(wait_ms);
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let mut output = self.snapshot(id, cursor)?;
            if !output.output.is_empty() || output.closed || wait_ms == 0 {
                return Ok(output);
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                output = self.snapshot(id, cursor)?;
                output.wait_timed_out = output.output.is_empty() && !output.closed;
                return Ok(output);
            }
        }
    }
}

#[cfg(test)]
mod tests;
