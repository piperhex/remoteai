use super::{state::Files, Error, Result};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Condvar, Mutex, OnceLock, Weak,
    },
};
use tokio::sync::{oneshot, OwnedSemaphorePermit};

type Reply<T> = oneshot::Sender<Result<T>>;
pub(super) enum Command {
    Write {
        index: usize,
        bytes: Vec<u8>,
        reply: Reply<()>,
        _permit: OwnedSemaphorePermit,
    },
    Flush {
        reply: Reply<()>,
        _permit: OwnedSemaphorePermit,
    },
    Finish {
        size: usize,
        reply: Reply<Vec<u8>>,
        _permit: OwnedSemaphorePermit,
    },
    Close,
}

pub(super) struct Control {
    sender: mpsc::Sender<Command>,
    closing: AtomicBool,
    completed: Mutex<bool>,
    completion: Condvar,
}

impl Control {
    pub(super) fn send(&self, command: Command) -> Result<()> {
        if self.closing.load(Ordering::Acquire) {
            return Err(Error::Unavailable);
        }
        self.sender.send(command).map_err(|_| Error::Unavailable)
    }

    pub(super) fn close(&self) {
        if !self.closing.swap(true, Ordering::AcqRel) {
            // A closed receiver already finished or failed, so no additional flush is possible.
            let _already_stopped = self.sender.send(Command::Close);
        }
    }

    pub(super) fn join(&self) {
        let mut completed = self
            .completed
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        while !*completed {
            completed = self
                .completion
                .wait(completed)
                .unwrap_or_else(|error| error.into_inner());
        }
    }
}

#[derive(Default)]
struct Registry {
    stopping: bool,
    writers: Vec<Weak<Control>>,
}

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(Mutex::default)
}

pub(super) fn open(
    directory: PathBuf,
    id: String,
    size: usize,
) -> Result<(Arc<Control>, Vec<bool>)> {
    let (files, done) = Files::open(directory, id, size)?;
    // Registration and shutdown are serialized; slow restore/hash I/O holds no registry lock.
    let mut registry = registry().lock().map_err(|_| Error::Unavailable)?;
    if registry.stopping {
        return Err(Error::Unavailable);
    }
    let (sender, receiver) = mpsc::channel();
    let control = Arc::new(Control {
        sender,
        closing: AtomicBool::new(false),
        completed: Mutex::new(false),
        completion: Condvar::new(),
    });
    let worker = control.clone();
    std::thread::Builder::new()
        .name("update-checkpoint".into())
        .spawn(move || {
            // Even a panic must release shutdown waiters. Files close before completion is signalled.
            let _completion = Completion(worker);
            run(files, receiver);
        })?;
    registry.writers.retain(|writer| writer.strong_count() > 0);
    registry.writers.push(Arc::downgrade(&control));
    Ok((control, done))
}

struct Completion(Arc<Control>);
impl Drop for Completion {
    fn drop(&mut self) {
        self.0.closing.store(true, Ordering::Release);
        *self
            .0
            .completed
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = true;
        self.0.completion.notify_all();
    }
}

fn run(mut files: Files, receiver: mpsc::Receiver<Command>) {
    loop {
        match receiver.recv_timeout(files.wait()) {
            Ok(command) => {
                if !handle(&mut files, command) {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Err(error) = files.flush() {
                    eprintln!("could not checkpoint update download: {error}");
                    break;
                }
            }
        }
    }
    if let Err(error) = files.flush() {
        // Keep the previous durable ledger. Recovery re-downloads the uncommitted tail.
        eprintln!("could not flush interrupted update download: {error}");
    }
}

fn handle(files: &mut Files, command: Command) -> bool {
    match command {
        Command::Write {
            index,
            bytes,
            reply,
            _permit,
        } => reply_result(reply, files.write(index, &bytes)),
        Command::Flush { reply, _permit } => reply_result(reply, files.flush()),
        Command::Finish {
            size,
            reply,
            _permit,
        } => {
            reply_result(reply, files.finish(size));
            false
        }
        Command::Close => false,
    }
}

fn reply_result<T>(reply: Reply<T>, result: Result<T>) -> bool {
    let success = result.is_ok();
    // Cancellation can drop the receiver; persistence still completes in this worker.
    let _cancelled = reply.send(result);
    success
}

pub(super) fn shutdown() {
    let writers = {
        let mut registry = registry().lock().unwrap_or_else(|error| error.into_inner());
        registry.stopping = true;
        registry
            .writers
            .iter()
            .filter_map(Weak::upgrade)
            .collect::<Vec<_>>()
    };
    for writer in &writers {
        writer.close();
    }
    for writer in writers {
        writer.join();
    }
}
