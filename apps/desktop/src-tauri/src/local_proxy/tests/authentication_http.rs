fn authentication_retry_upstream(status: u16) -> (String, thread::JoinHandle<Vec<String>>) {
    let server = Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}", server.server_addr());
    let worker = thread::spawn(move || {
        let mut authorizations = Vec::new();
        for status in [status, 200] {
            let mut request = server
                .recv_timeout(Duration::from_secs(10))
                .unwrap()
                .unwrap();
            authorizations.push(
                request
                    .headers()
                    .iter()
                    .find(|header| header.field.equiv("Authorization"))
                    .unwrap()
                    .value
                    .to_string(),
            );
            let mut body = String::new();
            request.as_reader().read_to_string(&mut body).unwrap();
            assert!(body.contains("hello"));
            request
                .respond(
                    Response::from_string(r#"{"id":"ok","status":"completed","output":[]}"#)
                        .with_status_code(status)
                        .with_header(
                            Header::from_bytes("Content-Type", "application/json").unwrap(),
                        ),
                )
                .unwrap();
        }
        authorizations
    });
    (url, worker)
}

fn authentication_retry_account(paths: &Paths, name: &str, remaining: f64) -> String {
    let member = aggregate_official_account(paths, &format!("{name}@example.test"));
    let id = aggregate_api::member_account_id(&member)
        .unwrap()
        .to_string();
    let mut usage = account_with_usage(&id, remaining, 80.0).usage;
    usage.fetched_at = Some(chrono::Utc::now().to_rfc3339());
    crate::storage::save_usage(&usage_path(paths, &id), &usage).unwrap();
    id
}

#[test]
fn gui_authentication_retry_replays_http_with_backup_credentials() {
    for mode in ["sequential", "concurrent"] {
        for status in [401, 403] {
            assert_gui_authentication_http_retry(mode, status);
        }
    }
}

fn assert_gui_authentication_http_retry(mode: &str, status: u16) {
    let app = breakdown_responsiveness_test_app();
    app.manage(crate::codex_gui::web::WebEventState::default());
    let paths = resolve_paths(app.handle()).unwrap();
    let first = authentication_retry_account(&paths, "expired", 10.0);
    let second = authentication_retry_account(&paths, "healthy", 50.0);
    configure_authentication_retry_gui(&paths, mode, &first);
    let shared = read_state(&paths);
    let (url, worker) = authentication_retry_upstream(status);
    let _upstream = AggregateOfficialUpstream::set(&url);
    let response = handle_proxy_request(
        app.handle(),
        &Method::Post,
        "/codex-gui/v1/responses",
        &[],
        br#"{"model":"test-model","input":"hello","stream":false}"#.to_vec(),
        Some("auth-http-session"),
        None,
    )
    .unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(
        response.token_usage_account.as_ref().unwrap().account_id,
        second
    );
    assert_eq!(
        worker.join().unwrap(),
        [
            "Bearer test-token-expired@example.test",
            "Bearer test-token-healthy@example.test"
        ]
    );
    let selected = crate::codex_gui::account_selection::read(app.handle()).unwrap();
    assert_eq!(
        selected,
        crate::codex_gui::account_selection::GuiAccountSelection::Account(
            if mode == "concurrent" { first } else { second }
        )
    );
    assert_eq!(
        serde_json::to_value(read_state(&paths)).unwrap(),
        serde_json::to_value(shared).unwrap()
    );
    read_upstream_payload(response);
}

fn configure_authentication_retry_gui(paths: &Paths, mode: &str, first: &str) {
    let root = paths.state_file.parent().unwrap();
    crate::storage::write_json_atomic(
        &root.join("codex-gui-account.json"),
        &json!({"kind":"account", "id":first, "revision":1}),
    )
    .unwrap();
    crate::storage::write_json_atomic(
        &root.join("codex-gui-auto-switch.json"),
        &json!({"enabled":true, "switchOnQuotaExhaustion":false, "mode":mode, "revision":1}),
    )
    .unwrap();
}

#[test]
fn authentication_retry_catches_expired_credentials_before_sending_a_request() {
    use base64::Engine;
    let app = breakdown_responsiveness_test_app();
    let paths = resolve_paths(app.handle()).unwrap();
    let id = authentication_retry_account(&paths, "expired-refresh", 50.0);
    let path = managed_auth_path(&paths, &id);
    let mut auth = read_json(&path).unwrap();
    auth["tokens"]["access_token"] = format!(
        "e30.{}.sig",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"exp":0}"#)
    )
    .into();
    crate::storage::write_json_atomic(&path, &auth).unwrap();
    let response = forward_official(OfficialForwardRequest {
        app: app.handle(),
        method: &Method::Post,
        url: "/v1/responses",
        headers: &[],
        body: br#"{"input":"hello"}"#.to_vec(),
        model: "test-model",
        session_id: None,
        account_id_override: Some(&id),
    })
    .unwrap();
    assert_eq!(response.status, 401);
    assert_eq!(
        response.token_usage_account.as_ref().unwrap().account_id,
        id
    );
}
