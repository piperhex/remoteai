use super::{
    journal::{Claim, Journal},
    operations::{self, Backend},
    protocol::{self, Mutation, Send},
    *,
};
use serde_json::{json, Value};
use std::collections::VecDeque;
use tokio::sync::Mutex;

struct Fake(Mutex<VecDeque<(&'static str, Value, Result<Value>)>>);

impl Backend for Fake {
    async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let (expected_method, expected_params, result) =
            self.0.lock().await.pop_front().expect("unexpected RPC");
        assert_eq!(method, expected_method);
        assert_eq!(params, expected_params);
        result
    }
}

fn send() -> Send {
    Send {
        request_id: "request-one".into(),
        thread_id: "target".into(),
        message: "补充要求".into(),
    }
}

fn thread(active: bool) -> Value {
    json!({"thread":{"id":"target", "status":{"type":if active { "active" } else { "idle" }},
        "turns":if active { json!([{"id":"turn-one", "status":"inProgress", "items":[]}]) } else { json!([]) }}})
}

fn prompt() -> Value {
    json!({"threadId":"target", "input":[{"type":"text", "text":"补充要求", "text_elements":[]}]})
}

#[test]
fn tools_reject_unexpected_permissions_invalid_targets_and_empty_messages() {
    for arguments in [
        json!({"requestId":"one", "threadId":"../private", "message":"hello"}),
        json!({"requestId":"one", "threadId":"target", "message":" "}),
        json!({"requestId":"one", "threadId":"target", "message":"x", "access":"danger-full-access"}),
        json!({"requestId":"one", "threadId":"target", "message":"x".repeat(64_001)}),
        json!({"threadId":"target", "message":"hello"}),
    ] {
        assert!(
            protocol::parse(&json!({"name":"gui_send_message", "arguments":arguments})).is_err()
        );
    }
    let tools: Value = serde_json::from_str(protocol::TOOLS).unwrap();
    assert_eq!(tools["tools"].as_array().unwrap().len(), 4);
    assert!(protocol::parse(&json!({"name":"gui_list_running_conversations"})).is_ok());
}

#[tokio::test]
async fn identical_requests_survive_restart_and_changed_arguments_cannot_reuse_the_id() {
    let root = tempfile::tempdir().unwrap();
    let journal = Journal::default();
    let mutation = Mutation::Send(send());
    let Claim::New(mut entry) = journal.claim(root.path(), &mutation).await.unwrap() else {
        panic!("not new")
    };
    entry
        .update(json!({"threadId":"target", "turnId":"turn-one", "status":"sent"}))
        .await
        .unwrap();
    let restarted = Journal::default();
    let Claim::Existing(receipt) = restarted.claim(root.path(), &mutation).await.unwrap() else {
        panic!("replayed")
    };
    assert_eq!(receipt["status"], "sent");
    assert_eq!(receipt["requestId"], "request-one");
    let mut changed = send();
    changed.message = "different".into();
    assert!(matches!(
        restarted.claim(root.path(), &Mutation::Send(changed)).await,
        Err(Error::RequestConflict)
    ));
}

#[tokio::test]
async fn concurrent_duplicate_claims_cannot_both_send() {
    let root = tempfile::tempdir().unwrap();
    let journal = Journal::default();
    let mutation = Mutation::Send(send());
    let (first, second) = tokio::join!(
        journal.claim(root.path(), &mutation),
        journal.claim(root.path(), &mutation)
    );
    assert!(matches!(first.unwrap(), Claim::New(_)));
    assert!(matches!(second.unwrap(), Claim::Existing(_)));
}

#[tokio::test]
async fn running_conversations_are_steered_without_resuming_or_changing_settings() {
    let root = tempfile::tempdir().unwrap();
    let Claim::New(mut entry) = Journal::default()
        .claim(root.path(), &Mutation::Send(send()))
        .await
        .unwrap()
    else {
        panic!("not new")
    };
    let mut expected = prompt();
    expected["expectedTurnId"] = json!("turn-one");
    let fake = Fake(Mutex::new(VecDeque::from([
        (
            "thread/read",
            json!({"threadId":"target", "includeTurns":true}),
            Ok(thread(true)),
        ),
        ("turn/steer", expected, Ok(json!({"turnId":"turn-one"}))),
    ])));
    let receipt = operations::send(&fake, send(), &mut entry).await.unwrap();
    assert_eq!(receipt["status"], "steered");
    assert_eq!(receipt["turnId"], "turn-one");
    assert!(fake.0.lock().await.is_empty());
}

#[tokio::test]
async fn idle_targets_resume_without_overrides_and_resume_races_use_steering() {
    for became_active in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let Claim::New(mut entry) = Journal::default()
            .claim(root.path(), &Mutation::Send(send()))
            .await
            .unwrap()
        else {
            panic!("not new")
        };
        let mut expected = prompt();
        if became_active {
            expected["expectedTurnId"] = json!("turn-one");
        }
        let fake = Fake(Mutex::new(VecDeque::from([
            (
                "thread/read",
                json!({"threadId":"target", "includeTurns":true}),
                Ok(thread(false)),
            ),
            (
                "thread/resume",
                json!({"threadId":"target"}),
                Ok(thread(became_active)),
            ),
            (
                if became_active {
                    "turn/steer"
                } else {
                    "turn/start"
                },
                expected,
                Ok(json!({"turnId":"turn-one", "turn":{"id":"turn-one"}})),
            ),
        ])));
        operations::send(&fake, send(), &mut entry).await.unwrap();
        assert!(fake.0.lock().await.is_empty());
    }
}

#[tokio::test]
async fn failed_steers_are_not_retried_as_new_turns() {
    let root = tempfile::tempdir().unwrap();
    let journal = Journal::default();
    let mutation = Mutation::Send(send());
    let Claim::New(mut entry) = journal.claim(root.path(), &mutation).await.unwrap() else {
        panic!("not new")
    };
    let mut expected = prompt();
    expected["expectedTurnId"] = json!("turn-one");
    let fake = Fake(Mutex::new(VecDeque::from([
        (
            "thread/read",
            json!({"threadId":"target", "includeTurns":true}),
            Ok(thread(true)),
        ),
        ("turn/steer", expected, Err(Error::Changed)),
    ])));
    assert!(operations::send(&fake, send(), &mut entry).await.is_err());
    let Claim::Existing(receipt) = journal.claim(root.path(), &mutation).await.unwrap() else {
        panic!("replayed")
    };
    assert_eq!(receipt["status"], "unknown");
    assert_eq!(receipt["threadId"], "target");
}

#[tokio::test]
async fn creation_checkpoints_thread_before_sending_and_reports_uncertain_outcomes() {
    let root = tempfile::tempdir().unwrap();
    let journal = Journal::default();
    let mutation = Mutation::Create(protocol::Create {
        request_id: "create-one".into(),
        message: "补充要求".into(),
        cwd: None,
    });
    let Claim::New(mut entry) = journal.claim(root.path(), &mutation).await.unwrap() else {
        panic!("not new")
    };
    let fake = Fake(Mutex::new(VecDeque::from([
        ("thread/start", json!({"cwd":"project"}), Ok(thread(false))),
        (
            "turn/start",
            prompt(),
            Err(Error::Gui(crate::codex_gui::GuiError::Timeout)),
        ),
    ])));
    assert!(operations::create(
        &fake,
        json!({"cwd":"project"}),
        "补充要求".into(),
        &mut entry
    )
    .await
    .is_err());
    let Claim::Existing(receipt) = Journal::default()
        .claim(root.path(), &mutation)
        .await
        .unwrap()
    else {
        panic!("replayed")
    };
    assert_eq!(receipt["threadId"], "target");
    assert_eq!(receipt["status"], "unknown");
}

#[test]
fn reads_bound_text_and_hide_tools_attachments_and_old_snapshots() {
    let mut response = thread(false);
    let legacy = "<codex_gui_conversation_context>{\"kind\":\"awareness\",\"current\":\"hidden\",\"running\":[],\"total\":0,\"note\":\"old\"}</codex_gui_conversation_context>";
    response["thread"]["turns"] = json!([{"items":[
        {"type":"userMessage", "content":[{"type":"text", "text":format!("测试{legacy}")},
            {"type":"image", "url":"private-image"}]},
        {"type":"commandExecution", "aggregatedOutput":"private-output"},
        {"type":"agentMessage", "text":"🙂".repeat(5000)}
    ]}]);
    let result = summaries::read("target", response).unwrap();
    assert_eq!(result["messages"][0]["text"], "测试");
    assert_eq!(result["messages"].as_array().unwrap().len(), 2);
    assert_eq!(
        result["messages"][1]["text"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        4000
    );
    assert_eq!(result["truncated"], true);
    assert!(!result.to_string().contains("private"));
    assert!(!result.to_string().contains("hidden"));
}

#[tokio::test]
async fn successful_creation_returns_a_durable_receipt_without_resending() {
    let root = tempfile::tempdir().unwrap();
    let journal = Journal::default();
    let mutation = Mutation::Create(protocol::Create {
        request_id: "create-success".into(),
        message: "补充要求".into(),
        cwd: None,
    });
    let Claim::New(mut entry) = journal.claim(root.path(), &mutation).await.unwrap() else {
        panic!("not new")
    };
    let fake = Fake(Mutex::new(VecDeque::from([
        ("thread/start", json!({}), Ok(thread(false))),
        (
            "turn/start",
            prompt(),
            Ok(json!({"turn":{"id":"created-turn"}})),
        ),
    ])));
    let receipt = operations::create(&fake, json!({}), "补充要求".into(), &mut entry)
        .await
        .unwrap();
    assert_eq!(receipt["status"], "sent");
    assert_eq!(receipt["turnId"], "created-turn");
    let Claim::Existing(saved) = journal.claim(root.path(), &mutation).await.unwrap() else {
        panic!("replayed")
    };
    assert_eq!(receipt, saved);
    assert!(fake.0.lock().await.is_empty());
}

#[test]
fn mcp_handshake_and_listing_do_not_require_a_connected_engine() {
    let no_engine =
        |_| -> Result<Value> { panic!("metadata must not acquire the GUI client lock") };
    let initialize = http::dispatch(json!({"id":1,"method":"initialize"}), no_engine);
    assert_eq!(initialize["result"]["serverInfo"]["name"], "codex_gui");
    let listing = http::dispatch(json!({"id":2,"method":"tools/list"}), no_engine);
    assert_eq!(listing["result"]["tools"].as_array().unwrap().len(), 4);
    let failure = http::dispatch(json!({"id":3,"method":"tools/call", "params":{}}), |_| {
        Err(Error::Invalid)
    });
    assert_eq!(failure["result"]["isError"], true);
}

#[test]
fn http_requires_private_credentials_and_refuses_browser_origins() {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}/mcp", server.server_addr());
    let worker = std::thread::spawn(move || {
        for _ in 0..4 {
            let request = server
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap()
                .unwrap();
            http::handle(request, "Bearer test", |_| Ok(json!({"ok":true})));
        }
    });
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .build()
        .unwrap();
    for (token, origin, expected) in [
        ("", false, 403),
        ("wrong", false, 403),
        ("Bearer test", true, 403),
        ("Bearer test", false, 200),
    ] {
        let mut request = client
            .post(&url)
            .header("Authorization", token)
            .json(&json!({"id":1, "method":"tools/list"}));
        if origin {
            request = request.header("Origin", "https://example.org");
        }
        assert_eq!(request.send().unwrap().status().as_u16(), expected);
    }
    worker.join().unwrap();
}
