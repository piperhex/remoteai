use super::*;
use crate::codex_gui::recovery::Entry;

struct Fixture {
    home: tempfile::TempDir,
    state: ThreadCapacity,
    active: Mutex<HashMap<String, String>>,
}

impl Fixture {
    fn new() -> Self {
        Self {
            home: tempfile::tempdir().unwrap(),
            state: ThreadCapacity::default(),
            active: Mutex::default(),
        }
    }

    fn journal(&self) -> Journal {
        Journal::new(self.home.path())
    }

    fn interrupt(&self) -> Interrupt<'_> {
        Interrupt {
            state: &self.state,
            active_turns: &self.active,
            journal: self.journal(),
        }
    }

    async fn started(&self, thread: &str, turn: &str) {
        // The production event reader persists turn/started before updating active_turns.
        self.journal().started(thread, turn).unwrap();
        self.active.lock().await.insert(thread.into(), turn.into());
    }

    fn restarted(&self) -> Vec<Entry> {
        // A new process has a different launch ID. Reopen the on-disk journal as recovery_list does.
        rusqlite::Connection::open(self.home.path().join("remoteai-task-recovery.db"))
            .unwrap()
            .execute("UPDATE active_turns SET launch_id='previous-process'", [])
            .unwrap();
        self.journal().pending().unwrap()
    }
}

fn stop_a() -> Value {
    json!({"threadId": "task", "turnId": "A"})
}

#[tokio::test]
async fn stale_ui_stop_resolves_continuation_and_removes_its_persisted_record() {
    let fixture = Fixture::new();
    fixture.started("task", "A").await;
    fixture.started("task", "B").await;
    fixture.started("unrelated", "other-turn").await;
    fixture
        .interrupt()
        .run(stop_a(), |method, params| async move {
            assert_eq!(method, "turn/interrupt");
            assert_eq!(params, json!({"threadId": "task", "turnId": "B"}));
            Ok(json!({}))
        })
        .await
        .unwrap();
    let pending = fixture.restarted();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].thread_id, "unrelated");
    assert_eq!(pending[0].turn_id, "other-turn");
}

#[tokio::test]
async fn stop_waits_for_in_flight_continuation_before_selecting_and_clearing_its_turn() {
    let fixture = Fixture::new();
    fixture.started("task", "A").await;
    let switching = fixture.state.applied.lock().await;
    let generation = fixture.state.stops.load(Ordering::Acquire);
    let mut stopping = Box::pin(
        fixture
            .interrupt()
            .run(stop_a(), |method, params| async move {
                assert_eq!(method, "turn/interrupt");
                assert_eq!(params["turnId"], "B");
                Ok(json!({}))
            }),
    );
    assert!(futures_util::poll!(&mut stopping).is_pending());
    assert_ne!(fixture.state.stops.load(Ordering::Acquire), generation);
    // The automatic start was already dispatched when Stop arrived.
    fixture.started("task", "B").await;
    drop(switching);
    stopping.await.unwrap();
    assert!(fixture.restarted().is_empty());
}

#[tokio::test]
async fn stop_during_pause_cancels_continuation_and_clears_the_already_paused_turn() {
    let fixture = Fixture::new();
    fixture.started("task", "B").await;
    let switching = fixture.state.applied.lock().await;
    let mut stopping = Box::pin(
        fixture
            .interrupt()
            .run(stop_a(), |method, params| async move {
                assert_eq!(method, "thread/read");
                assert_eq!(params["threadId"], "task");
                Ok(json!({"thread": {"id": "task", "status": {"type": "idle"},
            "turns": [{"id": "B", "status": "interrupted"}]}}))
            }),
    );
    assert!(futures_util::poll!(&mut stopping).is_pending());
    fixture.active.lock().await.remove("task");
    drop(switching);
    stopping.await.unwrap();
    assert!(fixture.restarted().is_empty());
}

#[tokio::test]
async fn ordinary_and_repeated_stops_are_idempotent_across_restart() {
    let fixture = Fixture::new();
    fixture.started("task", "A").await;
    for _ in 0..2 {
        fixture
            .interrupt()
            .run(stop_a(), |method, params| async move {
                if method == "thread/read" {
                    return Ok(json!({"thread": {"id": "task", "status": {"type": "idle"},
                        "turns": [{"id": "A", "status": "interrupted"}]}}));
                }
                assert_eq!(method, "turn/interrupt");
                assert_eq!(params, stop_a());
                Ok(json!({}))
            })
            .await
            .unwrap();
        fixture.active.lock().await.remove("task");
    }
    assert!(fixture.restarted().is_empty());
}

#[tokio::test]
async fn acknowledged_stop_does_not_remove_a_newer_unstopped_turn() {
    let fixture = Fixture::new();
    fixture.started("task", "B").await;
    fixture
        .interrupt()
        .run(stop_a(), |method, params| {
            let fixture = &fixture;
            async move {
                assert_eq!(method, "turn/interrupt");
                assert_eq!(params["turnId"], "B");
                // An autonomous turn can start while the interrupt acknowledgement is in flight.
                fixture.started("task", "C").await;
                Ok(json!({}))
            }
        })
        .await
        .unwrap();
    let pending = fixture.restarted();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].turn_id, "C");
}

#[tokio::test]
async fn rejected_or_uncertain_stops_preserve_the_actual_turn_for_recovery() {
    for error in [GuiError::Rpc, GuiError::Timeout, GuiError::Disconnected] {
        let mut error = Some(error);
        let fixture = Fixture::new();
        fixture.started("task", "B").await;
        assert!(fixture
            .interrupt()
            .run(stop_a(), |method, params| {
                assert_eq!(method, "turn/interrupt");
                assert_eq!(params["turnId"], "B");
                std::future::ready(Err(error.take().unwrap()))
            })
            .await
            .is_err());
        let pending = fixture.restarted();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].turn_id, "B");
    }
}

#[tokio::test]
async fn delayed_continuation_event_is_resolved_from_the_engine_before_stopping() {
    for switch_in_flight in [false, true] {
        let fixture = Fixture::new();
        fixture.journal().started("task", "B").unwrap();
        let switching = if switch_in_flight {
            Some(fixture.state.applied.lock().await)
        } else {
            None
        };
        let mut calls = Vec::new();
        let mut stopping = Box::pin(fixture.interrupt().run(stop_a(), |method, params| {
            calls.push(method);
            let response = if method == "thread/read" {
                json!({"thread": {"id": "task", "status": {"type": "active"},
                "turns": [{"id": "B", "status": "inProgress"}]}})
            } else {
                assert_eq!(params["turnId"], "B");
                json!({})
            };
            std::future::ready(Ok(response))
        }));
        if switch_in_flight {
            assert!(futures_util::poll!(&mut stopping).is_pending());
        }
        drop(switching);
        stopping.await.unwrap();
        assert_eq!(calls, ["thread/read", "turn/interrupt"]);
        assert!(fixture.restarted().is_empty());
    }
}

#[tokio::test]
async fn failed_switch_read_still_sends_stop_without_deleting_an_unknown_turn() {
    let fixture = Fixture::new();
    fixture.journal().started("task", "B").unwrap();
    let switching = fixture.state.applied.lock().await;
    let mut calls = Vec::new();
    let mut stopping = Box::pin(fixture.interrupt().run(stop_a(), |method, params| {
        calls.push(method);
        if method == "turn/interrupt" {
            assert_eq!(params["turnId"], "A");
        }
        std::future::ready(Err(GuiError::Rpc))
    }));
    assert!(futures_util::poll!(&mut stopping).is_pending());
    drop(switching);
    assert!(stopping.await.is_err());
    assert_eq!(calls, ["thread/read", "turn/interrupt"]);
    assert_eq!(fixture.restarted()[0].turn_id, "B");
}

#[tokio::test]
async fn a_finished_switch_does_not_clear_a_new_turn_started_after_the_snapshot() {
    let fixture = Fixture::new();
    fixture.journal().started("task", "B").unwrap();
    let switching = fixture.state.applied.lock().await;
    let mut stopping = Box::pin(fixture.interrupt().run(stop_a(), |method, _| {
        assert_eq!(method, "thread/read");
        let fixture = &fixture;
        async move {
            fixture.started("task", "C").await;
            Ok(json!({"thread": {"id": "task", "status": {"type": "idle"},
                "turns": [{"id": "B", "status": "completed"}]}}))
        }
    }));
    assert!(futures_util::poll!(&mut stopping).is_pending());
    drop(switching);
    stopping.await.unwrap();
    assert_eq!(fixture.restarted()[0].turn_id, "C");
}

#[tokio::test]
async fn unavailable_journal_does_not_prevent_stopping_the_actual_turn() {
    let fixture = Fixture::new();
    fixture.started("task", "B").await;
    let mut stopping = fixture.interrupt();
    stopping.journal = Journal::new(&fixture.home.path().join("missing-parent"));
    let response = stopping
        .run(stop_a(), |method, params| async move {
            assert_eq!(method, "turn/interrupt");
            assert_eq!(params["turnId"], "B");
            Ok(json!({"stopped": true}))
        })
        .await
        .unwrap();
    assert_eq!(response["stopped"], true);
    assert_eq!(fixture.restarted()[0].turn_id, "B");
}

#[tokio::test]
async fn invalid_stop_does_not_dispatch_or_clear_recovery() {
    let fixture = Fixture::new();
    fixture.started("task", "A").await;
    let result = fixture
        .interrupt()
        .run(json!({"threadId": "task"}), |_, _| async {
            panic!("invalid stop must not be sent");
        })
        .await;
    assert!(matches!(result, Err(GuiError::InvalidRequest)));
    assert_eq!(fixture.state.stops.load(Ordering::Acquire), 0);
    assert_eq!(fixture.restarted()[0].turn_id, "A");
}
