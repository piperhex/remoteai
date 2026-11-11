use super::*;
use std::{cell::RefCell, collections::VecDeque, future::ready};

#[tokio::test]
async fn recent_context_is_bounded_chronological_and_marks_omissions() {
    let calls = RefCell::new(Vec::new());
    let result = recent("chat", 6, |method, params| {
        calls.borrow_mut().push((method, params.clone()));
        ready(Ok(if method == "thread/read" {
            assert_eq!(params["includeTurns"], false);
            json!({"thread":{"id":"chat","name":"reference"}})
        } else {
            assert_eq!(params["limit"], 6);
            json!({"data":[{"id":"new","items":[]},{"id":"old","items":[]}],"nextCursor":"older"})
        }))
    })
    .await
    .unwrap();
    assert_eq!(calls.borrow().len(), 2);
    assert_eq!(result["thread"]["turns"][0]["id"], "old");
    assert_eq!(result["thread"]["name"], "reference");
    assert_eq!(result["thread"]["historyTruncated"], true);
}

#[tokio::test]
async fn resume_preserves_settings_without_loading_message_bodies() {
    let mut data = json!({"model":"model","thread":{"id":"chat","cwd":"project"}});
    resume(&mut data, |method, params| {
        assert_eq!(method, "thread/turns/list");
        assert_eq!(params["itemsView"], "notLoaded");
        assert_eq!(params["limit"], 1);
        ready(Ok(
            json!({"data":[{"id":"running","status":"inProgress","items":[]}]}),
        ))
    })
    .await
    .unwrap();
    assert_eq!(data["model"], "model");
    assert_eq!(data["thread"]["cwd"], "project");
    assert_eq!(data["thread"]["turns"][0]["status"], "inProgress");
}

fn entry(id: &str) -> Value {
    json!({"turnId":"turn","item":{"id":id,"type":"commandExecution","aggregatedOutput":"complete output"},
        "startedAtMs":100,"completedAtMs":150})
}

#[tokio::test]
async fn details_follow_exact_turn_cursors_and_keep_outputs_and_timing() {
    let pages = RefCell::new(VecDeque::from([
        json!({"data":[entry("first")],"nextCursor":"next"}),
        json!({"data":[entry("last")],"nextCursor":null}),
    ]));
    let result = turn("chat", "turn", |method, params| {
        assert_eq!(method, "thread/items/list");
        assert_eq!(params["turnId"], "turn");
        assert_eq!(params["sortDirection"], "asc");
        if pages.borrow().len() == 1 {
            assert_eq!(params["cursor"], "next");
        }
        ready(Ok(pages.borrow_mut().pop_front().unwrap()))
    })
    .await
    .unwrap();
    let items = result["thread"]["turns"][0]["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["id"], "first");
    assert_eq!(items[1]["aggregatedOutput"], "complete output");
    assert_eq!(items[1]["completedAtMs"], 150);
}

#[tokio::test]
async fn details_reject_wrong_turn_duplicate_items_and_bad_cursors() {
    let mut wrong = entry("wrong");
    wrong["turnId"] = json!("other");
    for page in [
        json!({"data":[wrong]}),
        json!({"data":[entry("dup"),entry("dup")]}),
        json!({"data":[],"nextCursor":42}),
        json!({"data":[],"nextCursor":"repeat"}),
    ] {
        let result = turn("chat", "turn", |_, _| ready(Ok(page.clone()))).await;
        assert!(matches!(result, Err(GuiError::Rpc)));
    }
}

#[tokio::test]
async fn unsupported_or_failed_pagination_never_requests_full_history() {
    for unsupported in [true, false] {
        let result = recent("chat", 12, |method, params| {
            ready(if method == "thread/read" {
                assert_eq!(params["includeTurns"], false);
                Ok(json!({"thread":{"id":"chat"}}))
            } else if unsupported {
                Err(GuiError::UnsupportedMethod)
            } else {
                Err(GuiError::Timeout)
            })
        })
        .await;
        assert!(if unsupported {
            matches!(result, Err(GuiError::UnsupportedMethod))
        } else {
            matches!(result, Err(GuiError::Timeout))
        });
    }
}

#[tokio::test]
async fn timed_out_context_does_not_poison_the_next_read() {
    let result = tokio::time::timeout(
        std::time::Duration::from_millis(1),
        recent("chat", 6, |_, _| std::future::pending::<Result<Value>>()),
    )
    .await;
    assert!(result.is_err());
    let result = recent("chat", 6, |method, _| {
        ready(Ok(if method == "thread/read" {
            json!({"thread":{"id":"chat"}})
        } else {
            json!({"data":[]})
        }))
    })
    .await
    .unwrap();
    assert_eq!(result["thread"]["turns"], json!([]));
}

#[tokio::test]
async fn reference_marks_paginated_context_as_truncated() {
    let result = super::super::conversation_context::reference(
        &json!({"id":"chat",
        "turns":[],"historyTruncated":true}),
        1,
    )
    .unwrap();
    assert!(result["text"]
        .as_str()
        .unwrap()
        .contains("\"truncated\":true"));
}

#[tokio::test]
async fn one_tool_uses_exact_item_read_and_only_missing_method_falls_back() {
    for unsupported in [false, true] {
        let calls = RefCell::new(Vec::new());
        let result = item("chat", "turn", "tool", |method, params| {
            calls.borrow_mut().push(method);
            ready(if method == "thread/items/read" {
                assert_eq!(params["itemIds"], json!(["tool"]));
                if unsupported {
                    Err(GuiError::UnsupportedMethod)
                } else {
                    Ok(json!({"data":[entry("tool")]}))
                }
            } else {
                assert_eq!(method, "thread/items/list");
                Ok(json!({"data":[entry("tool")]}))
            })
        })
        .await
        .unwrap();
        assert_eq!(calls.borrow().len(), if unsupported { 2 } else { 1 });
        assert_eq!(result["thread"]["turns"][0]["items"][0]["id"], "tool");
    }
    let result = item("chat", "turn", "tool", |method, _| {
        assert_eq!(method, "thread/items/read");
        ready(Err(GuiError::Timeout))
    })
    .await;
    assert!(matches!(result, Err(GuiError::Timeout)));
}
