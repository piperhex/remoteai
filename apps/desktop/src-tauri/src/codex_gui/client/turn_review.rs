use super::Client;
use crate::codex_gui::{
    journal_worker::JournalWorker, protocol::GuiEvent, turn_review, worktree_observation::Baseline,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io,
    path::PathBuf,
    sync::{atomic::Ordering, Arc, Mutex, MutexGuard},
};
use tokio::sync::watch;

type ReviewStart = (String, Option<Baseline>);
type TurnKey = (String, String);
pub(super) type PendingStarts = HashMap<u64, (String, ReviewStart)>;

struct Journal {
    home: PathBuf,
    active: HashMap<TurnKey, ReviewStart>,
    gaps: HashSet<TurnKey>,
}

pub(super) struct ReviewQueue {
    worker: JournalWorker<Journal>,
    pending: Arc<PendingReviews>,
}

#[derive(Default)]
struct PendingReviews(Mutex<HashMap<String, watch::Receiver<()>>>);

impl PendingReviews {
    fn entries(&self) -> MutexGuard<'_, HashMap<String, watch::Receiver<()>>> {
        self.0.lock().unwrap_or_else(|error| error.into_inner())
    }
}

struct PendingReview {
    pending: Arc<PendingReviews>,
    done: watch::Sender<()>,
    thread: String,
}

impl Drop for PendingReview {
    fn drop(&mut self) {
        let mut entries = self.pending.entries();
        if entries
            .get(&self.thread)
            .is_some_and(|latest| latest.same_channel(&self.done.subscribe()))
        {
            entries.remove(&self.thread);
        }
    }
}

impl ReviewQueue {
    pub(super) fn new(home: PathBuf) -> io::Result<Self> {
        let journal = Journal {
            home,
            active: HashMap::new(),
            gaps: HashSet::new(),
        };
        Ok(Self {
            worker: JournalWorker::start("turn-review", journal)?,
            pending: Arc::default(),
        })
    }

    fn reserve(&self, thread: &str) -> PendingReview {
        let (done, receipt) = watch::channel(());
        self.pending.entries().insert(thread.into(), receipt);
        PendingReview {
            pending: self.pending.clone(),
            done,
            thread: thread.into(),
        }
    }

    pub(super) fn busy(&self) -> bool {
        !self.pending.entries().is_empty()
    }

    fn submit(&self, pending: PendingReview, job: impl FnOnce(&mut Journal) + Send + 'static) {
        if self
            .worker
            .submit(move |journal| {
                job(journal);
                drop(pending);
            })
            .is_err()
        {
            eprintln!("Codex GUI turn review worker is unavailable");
        }
    }
}

/// Queue only journal inputs. Command output and agent messages can dwarf the file changes.
fn evidence(event: &GuiEvent) -> Option<(TurnKey, GuiEvent)> {
    if !turn_review::observes(event) {
        return None;
    }
    let params = &event.params;
    let thread = params["threadId"].as_str()?;
    let turn = &params["turn"];
    let id = params["turnId"].as_str().or_else(|| turn["id"].as_str())?;
    let mut fields = json!({"threadId":thread, "turnId":id});
    for key in ["diff", "reviewIncomplete", "item"] {
        if let Some(value) = params.get(key) {
            fields[key] = value.clone();
        }
    }
    if turn.is_object() {
        let mut record = json!({"id":id});
        for key in ["status", "diff", "reviewIncomplete", "workspaceObservation"] {
            if let Some(value) = turn.get(key) {
                record[key] = value.clone();
            }
        }
        if let Some(items) = turn["items"].as_array() {
            record["items"] = items
                .iter()
                .filter(|item| item["type"] == "fileChange")
                .cloned()
                .collect();
        }
        fields["turn"] = record;
    }
    Some((
        (thread.into(), id.into()),
        GuiEvent {
            method: event.method.clone(),
            params: fields,
            id: None,
        },
    ))
}

impl Client {
    /// Only callers requesting durable review data wait. The stdout dispatcher never takes this path.
    pub(in crate::codex_gui) async fn wait_for_reviews(&self, thread: &str) {
        // Snapshot the last accepted entry. New writes on a busy thread cannot prolong this read.
        let last = self.reviews.pending.entries().get(thread).cloned();
        if let Some(mut receipt) = last {
            // Dropping the job closes its only sender, including on worker shutdown.
            let _ = receipt.changed().await;
        }
    }

    pub(super) async fn begin_review(&self, request: u64, params: &Value) {
        let Some(thread) = params["threadId"].as_str() else {
            return;
        };
        let cwd = match params["cwd"].as_str() {
            Some(cwd) => Some(cwd.to_owned()),
            None => {
                self.workspaces
                    .cwd(&self.notification_session, thread)
                    .await
            }
        };
        if let Some(cwd) = cwd {
            let path = cwd.clone();
            let baseline = tauri::async_runtime::spawn_blocking(move || Baseline::start(&path))
                .await
                .ok()
                .flatten();
            self.review_starts
                .lock()
                .await
                .insert(request, (thread.to_owned(), (cwd, baseline)));
        }
    }

    pub(super) async fn bind_review(self: &Arc<Self>, request: u64, result: &Value) {
        let start = self.review_starts.lock().await.remove(&request);
        let (Some((thread, start)), Some(turn)) = (start, result["turn"]["id"].as_str()) else {
            return;
        };
        let key = (thread.clone(), turn.to_owned());
        let publish = self.review_publisher();
        self.reviews
            .submit(self.reviews.reserve(&thread), move |journal| {
                journal.bind(key, start, publish);
            });
    }

    /// Reserve the journal entry before changing live state. Submit it after the wire event is published
    /// so even a fast worker cannot deliver its review first.
    pub(super) async fn prepare_review<'a>(
        self: &'a Arc<Self>,
        event: &GuiEvent,
    ) -> Option<impl FnOnce() + 'a> {
        let (key, event) = evidence(event)?;
        let pending = self.reviews.reserve(&key.0);
        let fallback = if event.method == "turn/started"
            && !self
                .review_starts
                .lock()
                .await
                .values()
                .any(|(id, _)| id == &key.0)
        {
            self.workspaces
                .cwd(&self.notification_session, &key.0)
                .await
        } else {
            None
        };
        let publish = self.review_publisher();
        Some(move || {
            self.reviews.submit(pending, move |journal| {
                journal.record(key, event, fallback, publish)
            })
        })
    }

    fn review_publisher(self: &Arc<Self>) -> impl FnOnce(GuiEvent) + Send + 'static {
        let client = Arc::downgrade(self);
        move |event| {
            if let Some(client) = client.upgrade().filter(|c| c.alive.load(Ordering::Acquire)) {
                client.publish_event(event);
            }
        }
    }
}

impl Journal {
    fn bind(&mut self, key: TurnKey, start: ReviewStart, publish: impl FnOnce(GuiEvent)) {
        let result = turn_review::bind_cwd(&self.home, &key.0, &key.1, &start.0);
        self.active.insert(key.clone(), start);
        match result {
            // A short turn may finish before its acknowledgement identifies the workspace.
            Ok(true) => {
                let event = GuiEvent {
                    method: "turn/completed".into(),
                    params: json!({"threadId":key.0,"turnId":key.1,"turn":{"id":key.1,"status":"completed"}}),
                    id: None,
                };
                self.record(key, event, None, publish);
            }
            Ok(false) => {}
            Err(_) => {
                self.gaps.insert(key);
            }
        }
    }

    fn record(
        &mut self,
        key: TurnKey,
        mut event: GuiEvent,
        fallback: Option<String>,
        publish: impl FnOnce(GuiEvent),
    ) {
        let finished = event.method == "turn/completed";
        let cwd = self
            .active
            .get(&key)
            .map(|start| start.0.clone())
            .or(fallback);
        if self.gaps.contains(&key) {
            event.params["reviewIncomplete"] = json!(true);
        }
        if finished {
            if let Some((_, Some(baseline))) = self.active.remove(&key) {
                event.params["turn"]["workspaceObservation"] = json!(baseline.finish());
            }
        }
        let stored = turn_review::record(&self.home, &event, cwd);
        let result = stored.and_then(|()| {
            self.gaps.remove(&key);
            if finished {
                self.summary(&key, &event).map(Some)
            } else {
                Ok(None)
            }
        });
        let review = match result {
            Ok(Some(review)) => review,
            Ok(None) => return,
            Err(_) => {
                eprintln!("Could not persist or restore turn review evidence");
                self.gaps.insert(key.clone());
                json!({"reviewIncomplete":true})
            }
        };
        publish(GuiEvent {
            method: "turn/review/updated".into(),
            id: None,
            params: json!({"threadId":key.0, "review":{"turnId":key.1,"fields":review}}),
        });
    }

    fn summary(&self, (thread, turn): &TurnKey, event: &GuiEvent) -> rusqlite::Result<Value> {
        let mut history =
            json!({"id":thread, "turns":[{"id":turn,"status":event.params["turn"]["status"]}]});
        turn_review::restore_page(&self.home, &mut history)?;
        let saved = &history["turns"][0];
        let mut fields =
            json!({"reviewCwd":saved["reviewCwd"],"reviewIncomplete":saved["reviewIncomplete"]});
        if let Some(observed) = saved.get("workspaceObservation") {
            fields["workspaceObservation"] = observed.clone();
        }
        if saved["reviewDeferred"].is_string() {
            fields["savedReviewResult"] = saved["reviewDeferred"].clone();
            fields["reviewHasEdits"] = saved["reviewHasEdits"].clone();
            if saved["reviewDeferred"] == "empty" {
                fields["diff"] = json!("");
            }
        } else {
            fields["diff"] = saved["diff"].clone();
        }
        Ok(fields)
    }
}
