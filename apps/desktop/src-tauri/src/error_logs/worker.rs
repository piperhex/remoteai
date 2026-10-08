use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc,
    },
    thread,
};

use chrono::Utc;
use rusqlite::Connection;

use super::{
    database,
    models::{ErrorLogPage, ErrorLogSource, ListQuery, LogError, NewEntry},
    sanitize,
};

const QUEUE_CAPACITY: usize = 1_024;
type Reply<T> = mpsc::Sender<Result<T, LogError>>;

enum Task {
    Record(NewEntry, Option<Reply<()>>),
    List(ListQuery, Reply<ErrorLogPage>),
    Clear(Reply<()>),
    #[cfg(test)]
    Shutdown(Reply<()>),
}

/// A single worker owns all SQLite state; callers never share or lock its connection.
pub(super) struct LogService {
    sender: mpsc::SyncSender<Task>,
    dropped_entries: Arc<AtomicU64>,
}

impl LogService {
    pub(super) fn start(path: PathBuf) -> Result<Self, LogError> {
        let (sender, receiver) = mpsc::sync_channel(QUEUE_CAPACITY);
        let dropped_entries = Arc::new(AtomicU64::new(0));
        let worker_dropped = dropped_entries.clone();
        thread::Builder::new()
            .name("error-log-writer".to_string())
            .spawn(move || run(&path, receiver, &worker_dropped))?;
        Ok(Self {
            sender,
            dropped_entries,
        })
    }

    pub(super) fn record_proxy(&self, message: &str, status: Option<u16>) {
        self.record_background(ErrorLogSource::Proxy, message, status);
    }

    pub(super) fn record_codex(&self, message: &str) {
        self.record_background(ErrorLogSource::Codex, message, None);
    }

    fn record_background(&self, source: ErrorLogSource, message: &str, status: Option<u16>) {
        let Some(entry) = new_entry(source, message, status) else {
            return;
        };
        match self.sender.try_send(Task::Record(entry, None)) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(Task::Record(entry, _))) => {
                self.dropped_entries.fetch_add(1, Ordering::Relaxed);
                eprintln!("Error log queue is full: {}", entry.message);
            }
            Err(mpsc::TrySendError::Disconnected(Task::Record(entry, _))) => {
                eprintln!("Error log worker is unavailable: {}", entry.message);
            }
            Err(_) => unreachable!("only record tasks are queued here"),
        }
    }

    pub(super) fn record_toast(&self, message: &str) -> Result<(), LogError> {
        let Some(entry) = new_entry(ErrorLogSource::Toast, message, None) else {
            return Ok(());
        };
        self.request(|reply| Task::Record(entry, Some(reply)))
    }

    pub(super) fn list(&self, query: ListQuery) -> Result<ErrorLogPage, LogError> {
        self.request(|reply| Task::List(query, reply))
    }

    pub(super) fn clear(&self) -> Result<(), LogError> {
        self.request(Task::Clear)
    }

    #[cfg(test)]
    pub(super) fn shutdown_for_test(self) -> Result<(), LogError> {
        self.request(Task::Shutdown)
    }

    fn request<T>(&self, task: impl FnOnce(Reply<T>) -> Task) -> Result<T, LogError> {
        let (reply, receiver) = mpsc::channel();
        self.sender
            .send(task(reply))
            .map_err(|_| LogError::Unavailable)?;
        receiver.recv().map_err(|_| LogError::Unavailable)?
    }
}

fn new_entry(source: ErrorLogSource, message: &str, status: Option<u16>) -> Option<NewEntry> {
    Some(NewEntry {
        created_at: Utc::now().to_rfc3339(),
        source,
        message: sanitize::message(message)?,
        status_code: status.filter(|code| (100..600).contains(code)),
    })
}

fn run(path: &Path, receiver: mpsc::Receiver<Task>, dropped: &AtomicU64) {
    let mut connection = None;
    for task in receiver {
        #[cfg(test)]
        if let Task::Shutdown(reply) = task {
            drop(connection);
            respond(reply, Ok(()));
            return;
        }
        record_overflow(&mut connection, path, dropped);
        handle_task(&mut connection, path, task);
    }
}

fn handle_task(connection: &mut Option<Connection>, path: &Path, task: Task) {
    match task {
        Task::Record(entry, reply) => {
            // Keep the sanitized cause available even when a full disk prevents saving the log.
            let fallback = entry.message.clone();
            let result = with_connection(connection, path, |db| database::insert(db, entry));
            if let Some(reply) = reply {
                respond(reply, result);
            } else if result.is_err() {
                eprintln!("Could not save an error log entry: {fallback}");
            }
        }
        Task::List(query, reply) => respond(
            reply,
            with_connection(connection, path, |db| database::list(db, query)),
        ),
        Task::Clear(reply) => respond(
            reply,
            with_connection(connection, path, |db| database::clear(db)),
        ),
        #[cfg(test)]
        Task::Shutdown(_) => unreachable!("shutdown is handled before database work"),
    }
}

fn record_overflow(connection: &mut Option<Connection>, path: &Path, dropped: &AtomicU64) {
    let count = dropped.swap(0, Ordering::Relaxed);
    if count == 0 {
        return;
    }
    let entry = NewEntry {
        created_at: Utc::now().to_rfc3339(),
        source: ErrorLogSource::Toast,
        message: format!("错误日志较多，已跳过 {count} 条记录。"),
        status_code: None,
    };
    if with_connection(connection, path, |db| database::insert(db, entry)).is_err() {
        dropped.fetch_add(count, Ordering::Relaxed);
        eprintln!("Could not save the error log overflow summary");
    }
}

fn with_connection<T>(
    connection: &mut Option<Connection>,
    path: &Path,
    operation: impl FnOnce(&mut Connection) -> Result<T, LogError>,
) -> Result<T, LogError> {
    if connection.is_none() {
        *connection = Some(database::open(path)?);
    }
    operation(connection.as_mut().ok_or(LogError::Unavailable)?)
}

fn respond<T>(reply: Reply<T>, result: Result<T, LogError>) {
    // A closed window may drop its waiting command; the completed database operation still stands.
    let _ = reply.send(result);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_proxy_queue_counts_skipped_entries_and_persists_a_recovery_summary() {
        let (sender, _receiver) = mpsc::sync_channel(1);
        let dropped = Arc::new(AtomicU64::new(0));
        let service = LogService {
            sender,
            dropped_entries: dropped.clone(),
        };
        service.record_proxy("first error", Some(502));
        service.record_proxy("second error", Some(503));
        service.record_proxy("third error", Some(504));
        assert_eq!(dropped.load(Ordering::Relaxed), 2);

        let mut connection = Some(database::open(Path::new(":memory:")).unwrap());
        record_overflow(&mut connection, Path::new(":memory:"), &dropped);
        let page = database::list(
            connection.as_ref().unwrap(),
            ListQuery::new(None, None, None).unwrap(),
        )
        .unwrap();
        assert_eq!(page.entries.len(), 1);
        assert!(page.entries[0].message.contains("2 条"));
        assert_eq!(dropped.load(Ordering::Relaxed), 0);
    }
}
