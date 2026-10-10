use super::*;
use crate::codex_gui::protocol::GuiRequest;

fn thread() -> Value {
    json!({"id": "source", "name": "设计讨论", "cwd": "D:/project", "turns": [
        {"items": [{"type": "userMessage", "content": [{"type": "text", "text": "需要蓝色按钮"}]},
            {"type": "commandExecution", "aggregatedOutput": "private tool output"},
            {"type": "agentMessage", "text": "确定使用蓝色"}]}
    ]})
}

#[test]
fn list_previews_and_running_titles_never_expand_hidden_context() {
    let snapshot = reference(&thread(), 1).unwrap();
    let context = snapshot["text"].as_str().unwrap();
    let mut list = json!({"data": [
        {"id": "one", "preview": format!("参考方案{context}")},
        {"id": "two", "preview": context},
        {"id": "three", "preview": "普通消息"},
        {"id": "four", "preview": ""},
    ]});
    assert_eq!(summary("one", &list["data"][0])["name"], "参考方案");
    assert_eq!(summary("four", &list["data"][3])["name"], "未命名对话");
    display(&mut list);
    assert_eq!(list["data"][0]["preview"], "参考方案");
    assert_eq!(list["data"][1]["preview"], "对话引用");
    assert_eq!(list["data"][2]["preview"], "普通消息");
    assert_eq!(list["data"][3]["preview"], "");
    assert!(!list.to_string().contains(CONTEXT_START));
}

fn params() -> Value {
    json!({"threadId": "current", "input": [{"type": "text", "text": "参考方案"},
        {"type": "mention", "name": "设计讨论", "path": "codex-thread://source"}]})
}

#[test]
fn snapshots_round_trip_to_visible_references_without_internal_context() {
    let mut params = params();
    append(&mut params, vec![reference(&thread(), 1).unwrap()]).unwrap();
    let mut result = json!({"thread": {"turns": [{"items": [
        {"type": "userMessage", "content": params["input"]}
    ]}]}});
    let encoded = result.to_string();
    assert!(encoded.contains("需要蓝色按钮"));
    assert!(encoded.contains("确定使用蓝色"));
    assert!(!encoded.contains("private tool output"));
    display(&mut result);
    assert_eq!(
        result["thread"]["turns"][0]["items"][0]["content"],
        self::params()["input"]
    );
    let again = result.clone();
    display(&mut result);
    assert_eq!(result, again);
}

#[test]
fn recent_context_is_bounded_unicode_safe_and_does_not_recurse() {
    let mut source = thread();
    let previous = reference(&source, 1).unwrap();
    source["turns"][0]["items"][0]["content"]
        .as_array_mut()
        .unwrap()
        .push(previous);
    source["turns"][0]["items"][1] =
        json!({"type": "agentMessage", "text": "中文🙂".repeat(20_000)});
    let snapshot = reference(&source, MAX_REFERENCES).unwrap();
    let Some(Context::Reference {
        messages,
        truncated,
        ..
    }) = parse(&snapshot)
    else {
        panic!("missing context")
    };
    assert!(truncated);
    assert_eq!(messages.last().unwrap()["text"], "确定使用蓝色");
    assert!(
        messages
            .iter()
            .map(|message| message["text"].as_str().unwrap().chars().count())
            .sum::<usize>()
            <= TOTAL_CONTEXT_CHARS / MAX_REFERENCES
    );
    assert!(!snapshot["text"]
        .as_str()
        .unwrap()
        .contains("\\n<codex_gui_conversation_context>"));
}

#[test]
fn references_are_validated_deduplicated_and_self_reference_is_rejected() {
    let mut params = params();
    let duplicate = params["input"][1].clone();
    params["input"].as_array_mut().unwrap().push(duplicate);
    assert_eq!(references(&params).unwrap(), vec!["source"]);
    for path in [
        "codex-thread://",
        "codex-thread://../other",
        "codex-thread://bad\0id",
        "codex-thread://current",
    ] {
        params["input"][1]["path"] = json!(path);
        assert!(references(&params).is_err());
    }
    params["input"] = json!((0..=MAX_REFERENCES)
        .map(|index| json!({
            "type": "mention", "path": format!("codex-thread://source-{index}")
        }))
        .collect::<Vec<_>>());
    assert!(references(&params).is_err());
}

#[test]
fn ordinary_messages_do_not_attach_activity_and_legacy_snapshots_still_hide() {
    let mut params =
        json!({"threadId": "current", "input": [{"type": "text", "text": "普通消息"}]});
    let original = params.clone();
    append(&mut params, vec![]).unwrap();
    assert_eq!(params, original);
    params["input"].as_array_mut().unwrap().push(
        input(Context::Awareness {
            current: "current".into(),
            running: vec![],
            total: 0,
            note: "旧版概览".into(),
        })
        .unwrap(),
    );
    let mut event = json!({"item": {"type": "userMessage", "content": params["input"]}});
    display(&mut event);
    assert_eq!(
        event["item"]["content"],
        json!([{"type": "text", "text": "普通消息"}])
    );
    let mut tool = json!({"type": "mcpToolCall", "result": {"item": {
        "type": "userMessage", "content": params["input"]}}});
    let original = tool.clone();
    display(&mut tool);
    assert_eq!(tool, original);
}

#[test]
fn single_queued_and_steering_requests_accept_conversation_attachments() {
    let message = json!({"text": "", "images": [], "attachments": [
        {"kind": "conversation", "name": "设计讨论", "path": "codex-thread://source"}
    ]});
    for operation in ["send", "sendBatch", "steer"] {
        let mut request = message.clone();
        request["operation"] = json!(operation);
        request["threadId"] = json!("current");
        request["turnId"] = json!("turn");
        request["messages"] = json!([message]);
        let (_, params) = serde_json::from_value::<GuiRequest>(request)
            .unwrap()
            .into_rpc()
            .unwrap();
        assert_eq!(references(&params).unwrap(), vec!["source"]);
    }
}

#[test]
fn nested_context_is_omitted_and_history_is_limited_to_recent_messages() {
    let mut source = thread();
    let nested = reference(&source, 1).unwrap();
    source["turns"] = json!([{ "items": (0..20).map(|number| json!({
        "type": "userMessage", "content": [{"type": "text", "text": format!("消息 {number}")}, nested]
    })).collect::<Vec<_>>() }]);
    let snapshot = reference(&source, 1).unwrap();
    let Some(Context::Reference {
        messages,
        truncated,
        ..
    }) = parse(&snapshot)
    else {
        panic!("missing context")
    };
    assert!(truncated);
    assert_eq!(messages.len(), MAX_MESSAGES);
    assert_eq!(messages[0]["text"], "消息 8");
    assert_eq!(messages.last().unwrap()["text"], "消息 19");
}
