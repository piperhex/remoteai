//! Persist lifecycle records independently of the renderer and consume decisions atomically.
use rusqlite::{params, Connection};
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

use super::{Entry, Error, Result};

static LAUNCH: OnceLock<String> = OnceLock::new();

pub(super) fn launch_id() -> &'static str {
    LAUNCH.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

#[derive(Clone)]
pub(in crate::codex_gui) struct Journal {
    path: PathBuf,
    launch: String,
}

impl Journal {
    pub(in crate::codex_gui) fn new(home: &Path) -> Self {
        Self {
            path: home.join("remoteai-task-recovery.db"),
            launch: launch_id().to_owned(),
        }
    }

    fn connect(&self) -> Result<Connection> {
        let connection = Connection::open(&self.path).map_err(|_| Error::Storage)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| Error::Storage)?;
        connection
            .execute_batch(
                "PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS active_turns (
                thread_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL,
                launch_id TEXT NOT NULL, observed_at INTEGER NOT NULL
            );",
            )
            .map_err(|_| Error::Storage)?;
        Ok(connection)
    }

    pub(in crate::codex_gui) fn started(&self, thread: &str, turn: &str) -> Result<()> {
        self.connect()?
            .execute(
                "INSERT OR REPLACE INTO active_turns VALUES (?1, ?2, ?3, ?4)",
                params![
                    thread,
                    turn,
                    self.launch,
                    chrono::Utc::now().timestamp_millis()
                ],
            )
            .map_err(|_| Error::Storage)?;
        Ok(())
    }

    pub(in crate::codex_gui) fn finished(&self, thread: &str, turn: &str) -> Result<()> {
        self.connect()?
            .execute(
                "DELETE FROM active_turns WHERE thread_id=?1 AND turn_id=?2",
                params![thread, turn],
            )
            .map_err(|_| Error::Storage)?;
        Ok(())
    }

    pub(super) fn remove_thread(&self, thread: &str) -> Result<()> {
        self.connect()?
            .execute("DELETE FROM active_turns WHERE thread_id=?1", [thread])
            .map_err(|_| Error::Storage)?;
        Ok(())
    }

    pub(in crate::codex_gui) fn pending(&self) -> Result<Vec<Entry>> {
        let connection = self.connect()?;
        let mut query = connection
            .prepare(
                "SELECT thread_id, turn_id, observed_at FROM active_turns WHERE launch_id != ?1",
            )
            .map_err(|_| Error::Storage)?;
        let rows = query
            .query_map([&self.launch], |row| {
                Ok(Entry {
                    thread_id: row.get(0)?,
                    turn_id: row.get(1)?,
                    observed_at: row.get(2)?,
                })
            })
            .map_err(|_| Error::Storage)?;
        rows.collect::<std::result::Result<_, _>>()
            .map_err(|_| Error::Storage)
    }

    pub(super) fn claim(&self, entries: &[Entry]) -> Result<Vec<Entry>> {
        let mut connection = self.connect()?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| Error::Storage)?;
        let mut claimed = Vec::new();
        for entry in entries {
            use rusqlite::OptionalExtension;
            let observed_at = transaction.query_row(
                "DELETE FROM active_turns WHERE thread_id=?1 AND turn_id=?2 AND launch_id != ?3 RETURNING observed_at",
                params![entry.thread_id, entry.turn_id, self.launch], |row| row.get(0),
            ).optional().map_err(|_| Error::Storage)?;
            if let Some(observed_at) = observed_at {
                claimed.push(Entry {
                    observed_at,
                    ..entry.clone()
                });
            }
        }
        transaction.commit().map_err(|_| Error::Storage)?;
        Ok(claimed)
    }
}

pub(in crate::codex_gui) async fn access<T: Send + 'static>(
    journal: Journal,
    operation: impl FnOnce(Journal) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || operation(journal))
        .await
        .map_err(|_| Error::Storage)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removing_deleted_threads_preserves_other_recovery_records() {
        let root = tempfile::tempdir().unwrap();
        let mut journal = Journal::new(root.path());
        for thread in ["deleted", "child", "valid"] {
            journal.started(thread, "turn").unwrap();
        }
        journal.launch = "restarted".into();
        journal.remove_thread("deleted").unwrap();
        journal.remove_thread("child").unwrap();
        journal.remove_thread("deleted").unwrap();
        let pending = journal.pending().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].thread_id, "valid");
    }

    #[test]
    fn restart_consumes_only_prior_launch_and_exact_turn_once() {
        let root = tempfile::tempdir().unwrap();
        let mut journal = Journal::new(root.path());
        journal.launch = "previous".into();
        journal.started("stopped", "old").unwrap();
        journal.started("continued", "old").unwrap();
        assert!(journal.pending().unwrap().is_empty());
        journal.launch = "current".into();
        let candidates = journal.pending().unwrap();
        journal.started("continued", "new").unwrap();
        journal.finished("continued", "old").unwrap();
        let claimed = journal.claim(&candidates).unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].thread_id, "stopped");
        assert!(journal.claim(&candidates).unwrap().is_empty());
        journal.launch = "next".into();
        assert_eq!(journal.pending().unwrap()[0].turn_id, "new");
    }

    #[test]
    fn completed_and_manually_stopped_turns_do_not_return() {
        let root = tempfile::tempdir().unwrap();
        let mut journal = Journal::new(root.path());
        journal.started("task", "turn").unwrap();
        journal.finished("task", "turn").unwrap();
        journal.launch = "restarted".into();
        assert!(journal.pending().unwrap().is_empty());
    }

    #[test]
    fn two_clients_cannot_claim_the_same_task_and_cannot_replace_its_timestamp() {
        let root = tempfile::tempdir().unwrap();
        let mut journal = Journal::new(root.path());
        journal.started("task", "turn").unwrap();
        journal.launch = "restarted".into();
        let mut entries = journal.pending().unwrap();
        let timestamp = entries[0].observed_at;
        entries[0].observed_at = i64::MAX;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let (journal, entries, barrier) =
                    (journal.clone(), entries.clone(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    journal.claim(&entries).unwrap()
                })
            })
            .collect();
        let claimed: Vec<_> = workers
            .into_iter()
            .flat_map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].observed_at, timestamp);
    }
}
