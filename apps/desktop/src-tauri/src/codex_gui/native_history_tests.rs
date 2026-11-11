use super::*;
use std::{cell::RefCell, collections::VecDeque, future::ready};

fn turn(index: usize) -> Value {
    json!({"id":format!("t{index}"),"status":"completed",
        "items":[{"id":format!("i{index}"),"type":"agentMessage","text":format!("message {index}")}]})
}

#[test]
fn distinguishes_missing_methods_from_other_rpc_errors() {
    assert!(matches!(
        GuiError::from_rpc(&json!({"code":-32601,"message":"method not found"})),
        GuiError::UnsupportedMethod
    ));
    assert!(matches!(
        GuiError::from_rpc(&json!({"code":-32600,"message":"unknown variant `thread/turns/list`"})),
        GuiError::UnsupportedMethod
    ));
    assert!(matches!(
        GuiError::from_rpc(&json!({"code":-32603,"message":"history unavailable"})),
        GuiError::Rpc
    ));
}

#[tokio::test]
async fn reads_recent_pages_without_requesting_full_history() {
    let calls = RefCell::new(Vec::new());
    let responses = RefCell::new(VecDeque::from([
        json!({"thread":{"id":"chat","status":{"type":"notLoaded"}}}),
        json!({"data":(12..20).rev().map(turn).collect::<Vec<_>>(),"nextCursor":"older-1"}),
        json!({"data":(4..12).rev().map(turn).collect::<Vec<_>>(),"nextCursor":"older-2"}),
    ]));
    let (mut data, more) = read("chat", &HistoryWindow::default(), |method, params| {
        calls.borrow_mut().push((method, params));
        ready(Ok(responses.borrow_mut().pop_front().unwrap()))
    })
    .await
    .unwrap();
    assert!(more);
    assert_eq!(calls.borrow()[0].1["includeTurns"], false);
    assert!(calls
        .borrow()
        .iter()
        .skip(1)
        .all(|(method, params)| *method == "thread/turns/list" && params["itemsView"] == "full"));
    super::super::history_page::apply(&mut data, &HistoryWindow::default()).unwrap();
    assert_eq!(data["thread"]["turns"][0]["id"], "t10");
    assert_eq!(data["thread"]["turns"][9]["id"], "t19");
}

#[tokio::test]
async fn loads_older_messages_before_the_anchor_and_preserves_the_tail() {
    let window: HistoryWindow =
        serde_json::from_value(json!({"start":{"turnId":"t14","itemId":"i14"},"older":true}))
            .unwrap();
    let responses = RefCell::new(VecDeque::from([
        json!({"thread":{"id":"chat"}}),
        json!({"data":(12..20).rev().map(turn).collect::<Vec<_>>(),"nextCursor":"a"}),
        json!({"data":(4..12).rev().map(turn).collect::<Vec<_>>(),"nextCursor":"b"}),
    ]));
    let (mut data, more) = read("chat", &window, |_, _| {
        ready(Ok(responses.borrow_mut().pop_front().unwrap()))
    })
    .await
    .unwrap();
    assert!(more);
    super::super::history_page::apply(&mut data, &window).unwrap();
    assert_eq!(data["thread"]["turns"][0]["id"], "t4");
    assert_eq!(
        data["thread"]["turns"].as_array().unwrap().last().unwrap()["id"],
        "t19"
    );
}

#[tokio::test]
async fn unsupported_pagination_and_transport_errors_are_propagated_without_full_reads() {
    for unsupported in [true, false] {
        let mut first = true;
        let result = read("chat", &HistoryWindow::default(), |_, _| {
            let response = if first {
                first = false;
                Ok(json!({"thread":{"id":"chat"}}))
            } else if unsupported {
                Err(GuiError::UnsupportedMethod)
            } else {
                Err(GuiError::Disconnected)
            };
            ready(response)
        })
        .await;
        if unsupported {
            assert!(matches!(result, Err(GuiError::UnsupportedMethod)))
        } else {
            assert!(matches!(result, Err(GuiError::Disconnected)))
        }
    }
}

#[tokio::test]
async fn rejects_repeated_cursors_instead_of_looping_forever() {
    let mut first = true;
    let result = read("chat", &HistoryWindow::default(), |_, _| {
        ready(Ok(if first {
            first = false;
            json!({"thread":{"id":"chat"}})
        } else {
            json!({"data":[],"nextCursor":"same"})
        }))
    })
    .await;
    assert!(matches!(result, Err(GuiError::Rpc)));
}

#[tokio::test]
async fn deep_older_window_follows_cursors_and_keeps_the_recent_tail() {
    let window: HistoryWindow = serde_json::from_value(json!({
        "start":{"turnId":"t30","itemId":"i30"},"older":true
    }))
    .unwrap();
    let mut calls = 0;
    let (mut data, more) = read("chat", &window, |method, params| {
        calls += 1;
        assert!(calls <= 11, "history read exceeded the requested window");
        ready(Ok(if method == "thread/read" {
            assert_eq!(params["includeTurns"], false);
            json!({"thread":{"id":"chat"}})
        } else {
            assert_eq!(method, "thread/turns/list");
            assert_eq!(params["limit"], TURNS_PER_PAGE);
            let end = params["cursor"].as_str().map(|s| s.parse::<usize>().unwrap()).unwrap_or(100);
            let start = end.saturating_sub(TURNS_PER_PAGE);
            json!({"data":(start..end).rev().map(turn).collect::<Vec<_>>(),"nextCursor":start.to_string()})
        }))
    }).await.unwrap();
    assert!(more);
    super::super::history_page::apply(&mut data, &window).unwrap();
    let turns = data["thread"]["turns"].as_array().unwrap();
    assert_eq!(turns.first().unwrap()["id"], "t20");
    assert_eq!(turns.last().unwrap()["id"], "t99");
    assert_eq!(turns.len(), 80);
}

#[tokio::test]
async fn mismatched_metadata_is_rejected_before_loading_history() {
    let mut calls = 0;
    let result = read("chat", &HistoryWindow::default(), |_, _| {
        calls += 1;
        ready(Ok(json!({"thread":{"id":"different"}})))
    })
    .await;
    assert!(matches!(result, Err(GuiError::Rpc)));
    assert_eq!(calls, 1);
}
