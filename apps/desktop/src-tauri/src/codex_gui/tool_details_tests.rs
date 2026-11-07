use super::*;

fn command() -> Value {
    json!({"id":"cmd", "type":"commandExecution", "status":"completed", "exitCode":0,
        "command":"echo 中文\n".repeat(10_000), "aggregatedOutput":"private-output".repeat(100_000),
        "commandActions":[{"type":"unknown", "command":"large-input".repeat(100_000)}]})
}

#[test]
fn history_only_transports_bounded_summaries_and_exact_references() {
    let mut thread = json!({"id":"chat", "turns":[{"id":"turn", "items":[command(),
        {"id":"message", "type":"agentMessage", "text":"visible reply"},
        {"id":"tool", "type":"mcpToolCall", "tool":"exec", "arguments":{"code":"large"},
         "result":{"content":[{"text":"private"}]}}]}]});
    summarize_thread(&mut thread);
    let item = &thread["turns"][0]["items"][0];
    assert_eq!(
        item["detailsRef"],
        json!({"threadId":"chat", "turnId":"turn", "itemId":"cmd"})
    );
    assert_eq!(
        item["commandPreview"].as_str().unwrap().chars().count(),
        command_preview::MAX_PREVIEW_CHARS
    );
    assert!(item["aggregatedOutput"].is_null());
    assert!(item["command"].is_null());
    assert_eq!(item["exitCode"], 0);
    assert_eq!(thread["turns"][0]["items"][1]["text"], "visible reply");
    assert!(thread["turns"][0]["items"][2]["result"].is_null());
    assert!(item["commandPreview"].as_str().unwrap().ends_with('…'));
    assert!(thread.to_string().len() < 6000);
}

#[test]
fn streaming_payloads_stay_on_host_and_approvals_remain_complete() {
    let notification = json!({"method":"item/completed", "params":{"threadId":"chat", "turnId":"turn",
        "item":command()}});
    assert!(event(notification.clone()).unwrap().to_string().len() < 5000);
    let mut approval = notification;
    approval["id"] = json!(0);
    assert_eq!(event(approval.clone()), Some(approval));
    for method in [
        "item/commandExecution/outputDelta",
        "item/mcpToolCall/progress",
    ] {
        assert!(event(json!({"method":method,"params":{"delta":"private"}})).is_none());
    }
    let message =
        json!({"method":"item/agentMessage/delta","params":{"threadId":"chat","delta":"reply"}});
    assert_eq!(event(message.clone()), Some(message));
}

#[test]
fn details_resolve_only_the_requested_thread_turn_and_execution_item() {
    let source = json!({"thread":{"id":"chat", "turns":[{"id":"turn", "items":[command(),
        {"id":"message","type":"userMessage","text":"private prompt"}]}]}});
    for (thread, turn, item) in [
        ("other", "turn", "cmd"),
        ("chat", "other", "cmd"),
        ("chat", "turn", "message"),
    ] {
        let target = Target {
            thread_id: thread.into(),
            turn_id: turn.into(),
            item_id: item.into(),
        };
        assert!(take_item(&mut source.clone(), &target).is_none());
    }
    let target = Target {
        thread_id: "chat".into(),
        turn_id: "turn".into(),
        item_id: "cmd".into(),
    };
    assert_eq!(take_item(&mut source.clone(), &target), Some(command()));
}
