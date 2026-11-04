//! Each authenticated control connection owns its commands and cancels all of them on disconnect.
use super::{executor, state, CommandRequest, RemoteError};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc,
    },
};

// Shared across reconnecting control sockets until old processes actually terminate.
static EXECUTING: AtomicUsize = AtomicUsize::new(0);
const MAX_RECENT_COMMAND_IDS: usize = super::protocol::MAX_CONCURRENT_COMMANDS * 4;

struct ExecutionGuard;
impl ExecutionGuard {
    fn acquire(limit: usize) -> super::Result<Self> {
        EXECUTING
            .try_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < limit).then_some(count + 1)
            })
            .map(|_| Self)
            .map_err(|_| RemoteError::Busy)
    }
}
impl Drop for ExecutionGuard {
    fn drop(&mut self) {
        EXECUTING.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(crate) fn enabled() -> bool {
    super::root()
        .and_then(|root| state::incoming(&root))
        .is_ok()
}

struct ActiveCommand {
    cancelled: Arc<AtomicBool>,
    result: mpsc::Receiver<Value>,
}

impl ActiveCommand {
    fn spawn(
        command_id: String,
        request: CommandRequest,
        grant: (PathBuf, String, String),
        guard: ExecutionGuard,
    ) -> super::Result<Self> {
        let (root, id, token) = grant;
        let cancelled = Arc::new(AtomicBool::new(false));
        let allowed = cancelled.clone();
        // One result slot per accepted command bounds memory and cannot overflow.
        let (sender, receiver) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .spawn(move || {
                let _guard = guard;
                let result = tauri::async_runtime::block_on(executor::execute(request, || {
                    !allowed.load(Ordering::Acquire) && state::authorized(&root, &id, &token)
                }));
                // A disconnected session intentionally discards its result.
                if sender.send(response(command_id, result)).is_err() {
                    eprintln!("remote command result discarded after connection closed");
                }
            })
            .map_err(|_| RemoteError::Execution)?;
        Ok(Self {
            cancelled,
            result: receiver,
        })
    }
}

type Grant = super::Result<(PathBuf, String, String)>;

pub(crate) struct CommandHost {
    active: HashMap<String, ActiveCommand>,
    recent: VecDeque<String>,
}

impl CommandHost {
    pub(crate) fn new() -> Self {
        Self {
            active: HashMap::new(),
            recent: VecDeque::new(),
        }
    }

    /// Immediate rejections return to the socket loop, never queued or silently dropped.
    pub(crate) fn request(
        &mut self,
        command_id: String,
        request: CommandRequest,
        limit: usize,
    ) -> Option<Value> {
        let grant = super::root().and_then(|root| {
            let (id, token) = state::incoming(&root)?;
            Ok((root, id, token))
        });
        self.request_with_grant(command_id, request, (limit, grant))
    }

    fn request_with_grant(
        &mut self,
        command_id: String,
        request: CommandRequest,
        policy: (usize, Grant),
    ) -> Option<Value> {
        // Replayed IDs must not run twice or complete the original request with a busy error.
        if self.active.contains_key(&command_id) || self.recent.contains(&command_id) {
            return None;
        }
        let result = self.start(&command_id, request, policy);
        result.err().map(|error| response(command_id, Err(error)))
    }

    fn start(
        &mut self,
        command_id: &str,
        request: CommandRequest,
        policy: (usize, Grant),
    ) -> super::Result<()> {
        let (limit, grant) = policy;
        if !(1..=super::protocol::MAX_CONCURRENT_COMMANDS).contains(&limit) {
            return Err(RemoteError::InvalidRequest);
        }
        request.validate()?;
        let grant = grant?;
        if self.active.len() >= limit {
            return Err(RemoteError::Busy);
        }
        let guard = ExecutionGuard::acquire(limit)?;
        let command = ActiveCommand::spawn(command_id.to_owned(), request, grant, guard)?;
        self.active.insert(command_id.to_owned(), command);
        Ok(())
    }

    pub(crate) fn cancel(&self, command_id: &str) {
        if let Some(command) = self.active.get(command_id) {
            command.cancelled.store(true, Ordering::Release);
        }
    }

    pub(crate) fn responses(&mut self) -> Vec<Value> {
        let mut responses = Vec::new();
        self.active.retain(|id, command| {
            let reply = match command.result.try_recv() {
                Ok(reply) => reply,
                Err(mpsc::TryRecvError::Empty) => return true,
                Err(mpsc::TryRecvError::Disconnected) => {
                    response(id.clone(), Err(RemoteError::Execution))
                }
            };
            responses.push(reply);
            self.recent.push_back(id.clone());
            false
        });
        while self.recent.len() > MAX_RECENT_COMMAND_IDS {
            self.recent.pop_front();
        }
        responses
    }
}

fn response(command_id: String, result: super::Result<super::protocol::CommandOutput>) -> Value {
    match result {
        Ok(data) => json!({"type":"remote-command-result", "commandId":command_id, "data":data}),
        Err(error) => {
            json!({"type":"remote-command-result", "commandId":command_id, "error":error.to_string()})
        }
    }
}

impl Drop for CommandHost {
    fn drop(&mut self) {
        for command in self.active.values() {
            command.cancelled.store(true, Ordering::Release);
        }
    }
}

#[cfg(test)]
#[path = "host_tests.rs"]
mod tests;
