//! Share one refresh result, including failures, with all requests from its generation.
use super::credential_session::SessionError;
use std::sync::{Condvar, Mutex};

#[derive(Debug, Default)]
struct Progress {
    version: u64,
    running: bool,
    result: Option<Result<(), String>>,
}

#[derive(Debug, Default)]
pub(super) struct RefreshFlight {
    progress: Mutex<Progress>,
    completed: Condvar,
}

impl RefreshFlight {
    pub(super) fn version(&self) -> Result<u64, String> {
        self.progress
            .lock()
            .map(|state| state.version)
            .map_err(|_| SessionError::Unavailable.to_string())
    }

    pub(super) fn run(
        &self,
        version: u64,
        refresh: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut state = self
            .progress
            .lock()
            .map_err(|_| SessionError::Unavailable.to_string())?;
        loop {
            if state.version > version {
                return state
                    .result
                    .clone()
                    .ok_or(SessionError::Unavailable.to_string())?;
            }
            if !state.running {
                state.running = true;
                break;
            }
            state = self
                .completed
                .wait(state)
                .map_err(|_| SessionError::Unavailable.to_string())?;
        }
        drop(state);
        let mut leader = Leader {
            flight: self,
            completed: false,
        };
        let result = refresh();
        leader.finish(result.clone());
        result
    }
}

struct Leader<'a> {
    flight: &'a RefreshFlight,
    completed: bool,
}

impl Leader<'_> {
    fn finish(&mut self, result: Result<(), String>) {
        let mut state = self
            .flight
            .progress
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.version += 1;
        state.running = false;
        state.result = Some(result);
        self.completed = true;
        self.flight.completed.notify_all();
    }
}

impl Drop for Leader<'_> {
    fn drop(&mut self) {
        if !self.completed {
            // A panicking worker must not strand refresh waiters indefinitely.
            self.finish(Err(SessionError::Unavailable.to_string()));
        }
    }
}
