use super::*;
use std::sync::{Arc, Mutex};
use tiny_http::{Response, Server};

fn records(count: usize) -> Value {
    Value::Array((0..count).map(|index| json!({
        "id": format!("fixture-{index}"), "note": "note", "name": "provider",
        "lastModifiedAt": "2026-01-01T00:00:00Z",
        "fieldModifiedAt": {"note": "2026-01-01T00:00:00Z", "name": "2026-01-01T00:00:00Z"}
    })).collect())
}

#[derive(Default)]
struct Fixture {
    rows: Vec<Value>,
    gets: usize,
    puts: Vec<usize>,
    fail_put: Option<usize>,
}

fn http_fixture(
    kind: &'static str,
    state: Arc<Mutex<Fixture>>,
) -> (String, std::thread::JoinHandle<()>) {
    let server = Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}", server.server_addr());
    let worker = std::thread::spawn(move || loop {
        let mut request = server
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
            .unwrap();
        if request.url() == "/stop" {
            request.respond(Response::empty(200)).unwrap();
            break;
        }
        assert_eq!(request.url(), format!("/sync/{kind}"));
        let mut state = state.lock().unwrap();
        let body = if request.method().as_str() == "GET" {
            state.gets += 1;
            json!({kind: state.rows})
        } else {
            assert_eq!(request.method().as_str(), "PUT");
            let body: Value = serde_json::from_reader(request.as_reader()).unwrap();
            let batch = body[kind].as_array().unwrap();
            assert!(batch.len() <= MAX_BATCH_RECORDS);
            state.puts.push(batch.len());
            if state.fail_put == Some(state.puts.len()) {
                request.respond(Response::empty(500)).unwrap();
                continue;
            }
            state.rows.extend(batch.iter().cloned());
            json!({"count": batch.len()})
        };
        request
            .respond(Response::from_string(body.to_string()))
            .unwrap();
    });
    (url, worker)
}

fn upload(url: &str, kind: &str, local: Value) -> Result<usize, String> {
    let client = Client::builder().no_proxy().build().unwrap();
    sync_records(kind, local, |method, path, body| {
        let mut request = client.request(method, format!("{url}{path}"));
        if let Some(body) = body {
            request = request.json(&body);
        }
        request
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .and_then(|response| response.json())
            .map(Some)
            .map_err(|error| error.to_string())
    })
}

#[test]
fn bounded_http_batches_and_unchanged_repeat_for_both_collections() {
    for kind in ["accounts", "providers"] {
        let state = Arc::new(Mutex::new(Fixture::default()));
        let (url, worker) = http_fixture(kind, state.clone());
        assert_eq!(upload(&url, kind, records(120)).unwrap(), 120);
        assert_eq!(upload(&url, kind, records(120)).unwrap(), 0);
        let state = state.lock().unwrap();
        assert_eq!(state.puts, [50, 50, 20]);
        assert_eq!(state.gets, 2);
        println!("{kind}: first 120 records = 1 GET + 3 PUT; repeat = 1 GET + 0 PUT");
        drop(state);
        Client::new().get(format!("{url}/stop")).send().unwrap();
        worker.join().unwrap();
    }
}

#[test]
fn failed_batch_is_retried_from_fresh_server_state() {
    let state = Arc::new(Mutex::new(Fixture {
        fail_put: Some(2),
        ..Default::default()
    }));
    let (url, worker) = http_fixture("accounts", state.clone());
    assert!(upload(&url, "accounts", records(120)).is_err());
    assert_eq!(state.lock().unwrap().rows.len(), 50);
    assert_eq!(upload(&url, "accounts", records(120)).unwrap(), 70);
    assert_eq!(state.lock().unwrap().puts, [50, 50, 50, 20]);
    assert_eq!(upload(&url, "accounts", records(120)).unwrap(), 0);
    // A different user/server, or server reset, has no old process-local receipt.
    state.lock().unwrap().rows.clear();
    assert_eq!(upload(&url, "accounts", records(120)).unwrap(), 120);
    Client::new().get(format!("{url}/stop")).send().unwrap();
    worker.join().unwrap();
}

#[test]
fn deletions_restore_versions_official_metadata_and_active_state() {
    let local = records(3);
    let mut snapshot = json!({"accounts": local, "deletedAccountIds": ["fixture-2"]});
    snapshot["accounts"].as_array_mut().unwrap().pop();
    assert!(pending_records("accounts", local.as_array().unwrap(), Some(&snapshot)).is_empty());
    snapshot["deletedAccountIds"] = json!([]);
    assert_eq!(
        pending_records("accounts", local.as_array().unwrap(), Some(&snapshot)).len(),
        1
    );
    let mut row = local[0].clone();
    let mut remote = row.clone();
    row["fieldModifiedAt"]["note"] = json!("2026-01-02T00:00:00Z");
    assert!(needs_upload(&row, &remote));
    assert!(!needs_upload(&remote, &row));
    remote["official"] = json!(true);
    assert!(!needs_upload(&row, &remote));
    row["note"] = json!("edited official note");
    assert!(needs_upload(&row, &remote));
    row["note"] = remote["note"].clone();
    row["active"] = json!(true);
    assert!(needs_upload(&row, &remote));
    remote["active"] = json!(true);
    assert!(!needs_upload(&row, &remote));
    row["privateDetails"] = json!({"alias": "personal"});
    row["fieldModifiedAt"]["privateDetails"] = json!("2026-01-02T00:00:00Z");
    assert!(needs_upload(&row, &remote));
}

#[test]
fn byte_budget_and_denied_read_keep_uploads_retriable() {
    let local = json!([{"id":"one", "data":"x".repeat(MAX_BATCH_BYTES / 2)},
        {"id":"two", "data":"x".repeat(MAX_BATCH_BYTES / 2)}]);
    let mut puts = 0;
    assert_eq!(
        sync_records("providers", local, |method, _, body| {
            if method == Method::GET {
                return Ok(None);
            }
            puts += 1;
            assert_eq!(body.unwrap()["providers"].as_array().unwrap().len(), 1);
            Ok(Some(json!({"count":1})))
        })
        .unwrap(),
        2
    );
    assert_eq!(puts, 2);
}

#[test]
fn nullable_provider_fields_can_be_cleared_and_unknown_versions_are_sent() {
    let remote = json!({"walletUsername": "old", "lastModifiedAt": "2026-01-01T00:00:00Z"});
    let local = json!({"walletUsername": null,
        "fieldModifiedAt": {"walletUsername": "2026-01-02T00:00:00Z"}});
    assert!(needs_upload(&local, &remote));
    assert!(needs_upload(
        &json!({"walletUsername": null, "fieldModifiedAt": {}}),
        &remote
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn delayed_batch_network_io_keeps_async_runtime_responsive() {
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (resume_tx, resume_rx) = std::sync::mpsc::channel();
    let task = tauri::async_runtime::spawn_blocking(move || {
        let mut started_tx = Some(started_tx);
        sync_records("accounts", records(120), |method, _, _| {
            if method == Method::GET {
                return Ok(Some(json!({"accounts": []})));
            }
            if let Some(started) = started_tx.take() {
                started.send(()).unwrap();
                resume_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            }
            Ok(Some(json!({"count": 50})))
        })
    });
    started_rx.await.unwrap();
    // The network worker remains blocked while the UI/runtime timer continues to run.
    tokio::time::sleep(Duration::from_millis(50)).await;
    resume_tx.send(()).unwrap();
    assert_eq!(task.await.unwrap().unwrap(), 120);
}

#[test]
fn server_millisecond_precision_does_not_repeat_unchanged_uploads() {
    let local =
        json!({"note": "same", "fieldModifiedAt": {"note": "2026-01-01T00:00:00.123456789Z"}});
    let remote = json!({"note": "same", "fieldModifiedAt": {"note": "2026-01-01T00:00:00.123Z"}});
    assert!(!needs_upload(&local, &remote));
    let changed = json!({"note": "next", "fieldModifiedAt": {"note": "2026-01-01T00:00:00.124Z"}});
    assert!(needs_upload(&changed, &remote));
}

#[test]
fn omitted_context_window_clears_but_omitted_advanced_settings_are_preserved() {
    let remote = json!({"contextWindow": 1000, "requestOptions": {"headers": {}},
        "lastModifiedAt": "2026-01-01T00:00:00Z"});
    let local = json!({"fieldModifiedAt": {"contextWindow": "2026-01-02T00:00:00Z"}});
    assert!(needs_upload(&local, &remote));
    for field in [
        "requestOptions",
        "privateDetails",
        "balanceScript",
        "marketSource",
    ] {
        assert!(!needs_upload(
            &json!({"fieldModifiedAt": {field: "2026-01-02T00:00:00Z"}}),
            &remote
        ));
    }
}
