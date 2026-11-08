use super::*;

fn event(method: &str, params: Value) -> GuiEvent {
    GuiEvent {
        method: method.into(),
        params,
        id: None,
    }
}

fn started(history: &mut LiveHistory, thread: &str) {
    history.receive(&event(
        "turn/started",
        json!({"threadId":thread,
        "turn":{"id":"turn","status":"inProgress","items":[]}}),
    ));
}

#[test]
fn opening_a_background_conversation_recovers_unpersisted_text_and_tool_output() {
    let mut history = LiveHistory::default();
    started(&mut history, "background");
    for (method, id, delta) in [
        ("item/agentMessage/delta", "answer", "hello"),
        ("item/agentMessage/delta", "answer", " world"),
        ("item/commandExecution/outputDelta", "tool", "result"),
    ] {
        history.receive(&event(
            method,
            json!({"threadId":"background","turnId":"turn","itemId":id,"delta":delta}),
        ));
    }
    let mut snapshot = json!({"thread":{"id":"background","turns":[]}});
    history.merge(&mut snapshot);
    assert_eq!(
        snapshot["thread"]["turns"][0]["items"][0]["text"],
        "hello world"
    );
    assert_eq!(
        snapshot["thread"]["turns"][0]["items"][1]["aggregatedOutput"],
        "result"
    );
    // A second read is idempotent, including when disk has caught up to the same text.
    let before = snapshot.clone();
    history.merge(&mut snapshot);
    assert_eq!(snapshot, before);
}

#[test]
fn completed_items_and_turns_replace_partial_snapshots_before_paging() {
    let mut history = LiveHistory::default();
    started(&mut history, "a");
    history.receive(&event(
        "item/agentMessage/delta",
        json!({"threadId":"a","turnId":"turn","itemId":"i","delta":"part"}),
    ));
    history.receive(&event(
        "item/completed",
        json!({"threadId":"a","turnId":"turn",
        "item":{"id":"i","type":"agentMessage","text":"complete"}}),
    ));
    history.receive(&event(
        "turn/completed",
        json!({"threadId":"a",
        "turn":{"id":"turn","status":"completed","items":[]}}),
    ));
    let mut snapshot = json!({"thread":{"id":"a","turns":[{"id":"old","items":[{"id":"old-item"}]},
        {"id":"turn","status":"inProgress","items":[{"id":"i","text":"part"}]}]}});
    history.merge(&mut snapshot);
    super::super::history_page::apply(
        &mut snapshot,
        &serde_json::from_value(json!({"pageSize":1})).unwrap(),
    )
    .unwrap();
    assert_eq!(snapshot["thread"]["turns"][0]["status"], "completed");
    assert_eq!(
        snapshot["thread"]["turns"][0]["items"][0]["text"],
        "complete"
    );
    assert_eq!(snapshot["page"]["hasMore"], true);
}

#[test]
fn terminal_command_results_cannot_be_restarted_by_cached_or_delayed_starts() {
    for status in ["completed", "failed", "declined", "interrupted"] {
        let mut history = LiveHistory::default();
        started(&mut history, "a");
        let params = json!({"threadId":"a","turnId":"turn","item":{
            "id":"cmd","type":"commandExecution","status":"inProgress",
            "exitCode":null,"durationMs":null,"aggregatedOutput":""}});
        history.receive(&event("item/started", params.clone()));
        let command = json!({"id":"cmd","type":"commandExecution","status":status,
            "exitCode":1,"durationMs":15000,"aggregatedOutput":"final output"});
        let mut snapshot = json!({"thread":{"id":"a","turns":[{
            "id":"turn","status":"inProgress","items":[command.clone()]}]}});
        history.merge(&mut snapshot);
        assert_eq!(snapshot["thread"]["turns"][0]["items"][0], command);
        history.receive(&event(
            "item/completed",
            json!({"threadId":"a","turnId":"turn","item":command}),
        ));
        history.receive(&event("item/started", params));
        assert_eq!(history.item("a", "turn", "cmd"), Some(command));
    }
}

#[test]
fn edits_clear_the_tail_and_completed_cache_does_not_evict_running_threads() {
    let mut history = LiveHistory::default();
    started(&mut history, "running");
    for index in 0..COMPLETED_THREADS + 10 {
        let id = index.to_string();
        started(&mut history, &id);
        history.receive(&event(
            "turn/completed",
            json!({"threadId":id,
            "turn":{"id":"turn","status":"completed","items":[]}}),
        ));
    }
    assert_eq!(history.turns.len(), COMPLETED_THREADS + 1);
    assert!(history.turns.contains_key("running"));
    history.receive(&event(
        "thread/historyChanged",
        json!({"threadId":"running"}),
    ));
    assert!(!history.turns.contains_key("running"));
}

#[test]
fn reasoning_parts_and_plans_survive_a_view_switch() {
    let mut history = LiveHistory::default();
    started(&mut history, "a");
    history.receive(&event(
        "item/reasoning/summaryTextDelta",
        json!({"threadId":"a","turnId":"turn",
        "itemId":"i","summaryIndex":1,"delta":"thinking"}),
    ));
    history.receive(&event(
        "turn/plan/updated",
        json!({"threadId":"a","turnId":"turn",
        "explanation":"plan explanation","plan":[{"step":"first","status":"inProgress"}]}),
    ));
    let mut snapshot = json!({"thread":{"id":"a","turns":[]}});
    history.merge(&mut snapshot);
    assert_eq!(
        snapshot["thread"]["turns"][0]["items"][0]["summary"][1],
        "thinking"
    );
    assert_eq!(
        snapshot["thread"]["turns"][0]["planExplanation"],
        "plan explanation"
    );
}

#[test]
fn unpersisted_reply_keeps_its_position_before_a_later_user_message() {
    let mut history = LiveHistory::default();
    started(&mut history, "a");
    for (id, kind) in [
        ("user", "userMessage"),
        ("answer", "agentMessage"),
        ("steer", "userMessage"),
    ] {
        history.receive(&event(
            "item/started",
            json!({"threadId":"a","turnId":"turn",
            "item":{"id":id,"type":kind,"text":id}}),
        ));
    }
    let mut snapshot = json!({"thread":{"id":"a","turns":[{"id":"turn","status":"inProgress",
        "items":[{"id":"user","type":"userMessage"},{"id":"steer","type":"userMessage"}]}]}});
    history.merge(&mut snapshot);
    let ids: Vec<_> = snapshot["thread"]["turns"][0]["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["user", "answer", "steer"]);
}
