//! Real engine plus local Responses fixture; no credentials or model credits.
use super::{fixture, model_catalog, write_config, Client};
use crate::codex_gui::{error::Result, history_access, history_page, native_history};
use serde_json::{json, Value};
use std::path::Path;
use tokio::sync::Mutex;

#[tokio::test]
#[ignore = "Set CODEX_GUI_TEST_CLI to a paginated Codex binary; local HTTP fixtures only"]
async fn real_cli_paged_history_resumes_without_losing_engine_context() {
    let executable =
        std::env::var_os("CODEX_GUI_TEST_CLI").expect("CODEX_GUI_TEST_CLI is required");
    let executable = Path::new(&executable);
    let server = fixture::Server::local(model_catalog(executable).await);
    let home = tempfile::tempdir().unwrap();
    write_config(home.path(), &server.url);
    let mut client = Client::start(executable, home.path()).await;
    let started = client
        .rpc(
            "thread/start",
            json!({"cwd":home.path(),
        "model":"gui-proxy-fixture","sandbox":"read-only","approvalPolicy":"never"}),
        )
        .await;
    let id = started["thread"]["id"].as_str().unwrap();
    for index in 0..14 {
        send(&mut client, id, &format!("history-marker-{index}")).await;
    }
    client.stop().await;
    // Restart the engine to ensure recovery reads its persisted state.
    let client = Mutex::new(Client::start(executable, home.path()).await);
    check_windows(&client, id).await;
    for index in 0..2 {
        let mut resumed = request(
            &client,
            "thread/resume",
            json!({"threadId":id,"excludeTurns":true}),
        )
        .await
        .unwrap();
        assert!(resumed["thread"]["turns"].as_array().unwrap().is_empty());
        assert_eq!(resumed["model"], "gui-proxy-fixture");
        history_access::resume(&mut resumed, |m, p| request(&client, m, p))
            .await
            .unwrap();
        let turns = resumed["thread"]["turns"].as_array().unwrap();
        assert_eq!(turns.len(), 1);
        assert!(turns[0]["items"].as_array().unwrap().is_empty());
        assert_eq!(turns[0]["status"], "completed");
        send(
            &mut *client.lock().await,
            id,
            &format!("after-resume-{index}"),
        )
        .await;
    }
    check_details(&client, id).await;
    client.lock().await.stop().await;
    let bodies = server.bodies.lock().unwrap();
    assert_eq!(bodies.len(), 16);
    let last = bodies.last().unwrap()["input"].to_string();
    for marker in [
        "history-marker-0",
        "history-marker-13",
        "after-resume-0",
        "after-resume-1",
    ] {
        assert!(
            last.contains(marker),
            "Early context missing from model input: {marker}"
        );
    }
}

async fn send(client: &mut Client, id: &str, text: &str) {
    let turn = client
        .rpc(
            "turn/start",
            json!({"threadId":id,
        "input":[{"type":"text","text":text}]}),
        )
        .await;
    client.completed(turn["turn"]["id"].as_str().unwrap()).await;
}

async fn request(client: &Mutex<Client>, method: &str, params: Value) -> Result<Value> {
    if method == "thread/read" {
        assert_eq!(params["includeTurns"], false);
    }
    if method == "thread/resume" {
        assert_eq!(params["excludeTurns"], true);
    }
    Ok(client.lock().await.rpc(method, params).await)
}

async fn check_windows(client: &Mutex<Client>, id: &str) {
    let window = history_page::HistoryWindow::default();
    let (mut latest, more) = native_history::read(id, &window, |m, p| request(client, m, p))
        .await
        .unwrap();
    assert!(more);
    history_page::apply(&mut latest, &window).unwrap();
    let anchor = latest["page"]["start"].clone();
    let count = latest["thread"]["turns"].as_array().unwrap().len();
    let window = serde_json::from_value(json!({"start":anchor,"older":true})).unwrap();
    let (mut older, _) = native_history::read(id, &window, |m, p| request(client, m, p))
        .await
        .unwrap();
    history_page::apply(&mut older, &window).unwrap();
    assert!(older["thread"]["turns"].as_array().unwrap().len() > count);
    assert_eq!(
        older["thread"]["turns"].as_array().unwrap().last(),
        latest["thread"]["turns"].as_array().unwrap().last()
    );
    for limit in [6, 12] {
        let recent = history_access::recent(id, limit, |m, p| request(client, m, p))
            .await
            .unwrap();
        assert_eq!(recent["thread"]["turns"].as_array().unwrap().len(), limit);
        assert_eq!(recent["thread"]["historyTruncated"], true);
    }
}

async fn check_details(client: &Mutex<Client>, id: &str) {
    let recent = history_access::recent(id, 1, |m, p| request(client, m, p))
        .await
        .unwrap();
    let turn = &recent["thread"]["turns"][0];
    let turn_id = turn["id"].as_str().unwrap();
    let item = turn["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["type"] == "agentMessage")
        .unwrap();
    let details = history_access::turn(id, turn_id, |m, p| request(client, m, p))
        .await
        .unwrap();
    assert_eq!(details["thread"]["turns"][0]["items"], turn["items"]);
    let exact = history_access::item(id, turn_id, item["id"].as_str().unwrap(), |m, p| {
        request(client, m, p)
    })
    .await
    .unwrap();
    let items = exact["thread"]["turns"][0]["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], item["id"]);
    assert_eq!(items[0]["text"], "loopback-ok");
}
