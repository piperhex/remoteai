use super::{Error, Journal, Result};
use crate::codex_gui::journal_worker::JournalWorker;
use serde_json::Value;
use std::{io, path::Path};

pub(in crate::codex_gui) struct Writer(JournalWorker<Journal>);

impl Writer {
    pub(in crate::codex_gui) fn open(home: &Path) -> io::Result<Self> {
        JournalWorker::start("turn-recovery", Journal::new(home)).map(Self)
    }

    /// Manual stops, deletions and recovery decisions use the same FIFO as the wire lifecycle.
    pub(in crate::codex_gui) async fn access<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&Journal) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        self.0
            .call(move |journal| operation(journal))
            .await
            .map_err(|_| Error::Storage)?
    }

    pub(in crate::codex_gui) fn event(&self, method: &str, params: &Value) {
        let Some(thread) = params["threadId"].as_str() else {
            return;
        };
        let started = match method {
            "turn/started" => true,
            "turn/completed" if params["turn"]["status"] != "interrupted" => false,
            "thread/archived" | "thread/deleted" => {
                let thread = thread.to_owned();
                self.enqueue(move |journal| journal.remove_thread(&thread));
                return;
            }
            _ => return,
        };
        let Some(turn) = params["turn"]["id"].as_str() else {
            return;
        };
        let (thread, turn) = (thread.to_owned(), turn.to_owned());
        self.enqueue(move |journal| {
            if started {
                journal.started(&thread, &turn)
            } else {
                journal.finished(&thread, &turn)
            }
        });
    }

    fn enqueue(&self, write: impl FnOnce(&Journal) -> Result<()> + Send + 'static) {
        if self
            .0
            .submit(move |journal| {
                if write(journal).is_err() {
                    eprintln!("Codex GUI could not persist task recovery state");
                }
            })
            .is_err()
        {
            eprintln!("Codex GUI task recovery worker is unavailable");
        }
    }
}
