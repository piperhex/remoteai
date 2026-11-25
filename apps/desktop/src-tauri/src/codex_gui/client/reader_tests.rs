use super::*;
use crate::codex_gui::{git, web, GuiState};
use std::{path::Path, process::Stdio};

// One real pair of pipes carries the start acknowledgement, lifecycle, output, approval and RPC reply.
const SERVER: &str = r#"
const lines = require('node:readline').createInterface({input: process.stdin});
const send = value => console.log(JSON.stringify(value));
const event = (method, params, id) => send({method, params: {threadId:'thread', ...params}, id});
let decision;
lines.on('line', line => {
    const {id, method, result} = JSON.parse(line);
    if (!method) { decision = result.decision; return; }
    const turn = {id:'first',status:'inProgress'};
    if (method === 'turn/start') {
        event('turn/started', {turn});
        return send({id, result:{turn}});
    }
    if (method === 'test/complete') {
        event('item/started', {turnId:'first',item:{id:'edit',type:'fileChange',changes:[],status:'inProgress'}});
        event('turn/diff/updated', {turnId:'first',diff:'diff --git a/file b/file\n+after\n'});
        event('turn/completed', {turn:{...turn,status:'completed'}});
        event('turn/started', {turn:{id:'next',status:'inProgress'}});
        event('item/agentMessage/delta', {turnId:'next',itemId:'answer',delta:'next output'});
        event('item/commandExecution/requestApproval', {turnId:'next'}, 'approval');
    }
    send({id, result:{method,decision}});
});
"#;

fn linked_checkout(root: &Path) -> PathBuf {
    let checkout = root.join("linked");
    for args in [
        vec!["init"],
        vec![
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "base",
        ],
        vec![
            "worktree",
            "add",
            "--detach",
            checkout.to_str().unwrap(),
            "HEAD",
        ],
    ] {
        let output = git::run(root, &args).unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    checkout
}

async fn attach(app: &AppHandle, home: &Path) -> Arc<Client> {
    let mut command = tokio::process::Command::new("node");
    command
        .args(["-e", SERVER])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::codex_gui::platform::hide_window(&mut command);
    let server = startup::ServerProcess {
        process: command.spawn().unwrap(),
        plugin_host: crate::windows_plugin_host::Host::start(home).unwrap(),
    };
    let client = Client::attach(app.clone(), home.into(), home.join("scratch"), server)
        .await
        .unwrap();
    client.activate();
    client
}

fn events(app: &AppHandle, cursor: &Value) -> Vec<Value> {
    let cursor = serde_json::from_value(cursor.clone()).unwrap();
    let batch = json!(web::poll(app, Some(cursor), None).unwrap());
    batch["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["payload"].clone())
        .collect()
}

async fn check_reader(client: &Client, checkout: &Path) {
    let start = client
        .request_raw("turn/start", json!({"threadId":"thread","cwd":checkout}))
        .await
        .unwrap();
    assert_eq!(start["turn"]["id"], "first");
    std::fs::write(checkout.join("file"), "after").unwrap();
    let result = client
        .request_raw("test/complete", json!({}))
        .await
        .unwrap();
    assert_eq!(result["method"], "test/complete");
    assert_eq!(client.active_turns.lock().await["thread"], "next");
    assert_eq!(
        client
            .live_item("thread", "next", "answer")
            .unwrap()
            .unwrap()["text"],
        "next output"
    );
    assert_eq!(
        client.pending_approvals().await[0].id,
        Some(json!("approval"))
    );
    client
        .respond(serde_json::from_value(json!({"id":"approval","decision":"decline"})).unwrap())
        .await
        .unwrap();
    let reply = client
        .request_raw("test/decision", json!({}))
        .await
        .unwrap();
    assert_eq!(reply["decision"], "decline");
}

#[tokio::test]
async fn locked_journals_leave_the_same_app_server_reader_responsive() {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(GuiState::default())
        .manage(web::WebEventState::default())
        .build(context)
        .unwrap();
    let app = app.handle();
    crate::cloud::initialize_push_routing(app, &Default::default());
    let home = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let checkout = linked_checkout(repo.path());
    let cursor = json!(web::poll(app, None, None).unwrap())["cursor"].clone();
    let client = attach(app, home.path()).await;
    let locks = ["turn-reviews.sqlite", "remoteai-task-recovery.db"].map(|file| {
        let db = rusqlite::Connection::open(home.path().join(file)).unwrap();
        db.execute_batch("BEGIN EXCLUSIVE").unwrap();
        db
    });
    timeout(Duration::from_secs(3), check_reader(&client, &checkout))
        .await
        .expect("stdout waited for a journal while its SQLite write lock was held");
    let before = events(app, &cursor);
    assert_eq!(
        before
            .iter()
            .filter(|e| e["method"] == "turn/completed")
            .count(),
        1
    );
    assert!(before.iter().all(|e| e["method"] != "turn/review/updated"));
    drop(locks);
    timeout(Duration::from_secs(10), client.wait_for_reviews("thread"))
        .await
        .unwrap();
    let after = events(app, &cursor);
    let review = &after
        .iter()
        .find(|e| e["method"] == "turn/review/updated")
        .unwrap()["params"]["review"];
    assert_eq!(review["turnId"], "first");
    assert_eq!(review["fields"]["savedReviewResult"], "net");
    assert_eq!(review["fields"]["reviewIncomplete"], false);
    assert_eq!(
        review["fields"]["workspaceObservation"]["paths"],
        json!(["file"])
    );
    assert_eq!(
        after
            .iter()
            .filter(|e| e["method"] == "turn/completed")
            .count(),
        1
    );
    client.recovery.access(|_| Ok(())).await.unwrap();
    let db = rusqlite::Connection::open(home.path().join("remoteai-task-recovery.db")).unwrap();
    let active: String = db
        .query_row("SELECT turn_id FROM active_turns", [], |row| row.get(0))
        .unwrap();
    assert_eq!(active, "next");
    client.stop().await;
}
