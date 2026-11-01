fn anthropic_session_test_body(identity: Option<Value>) -> Vec<u8> {
    let mut body = json!({
        "model": "claude-sonnet", "stream": true, "max_tokens": 256,
        "messages": [{ "role": "user", "content": "hello" }]
    });
    if let Some(identity) = identity {
        body["metadata"] = identity;
    }
    serde_json::to_vec(&body).unwrap()
}

fn tracked_anthropic_test_request(
    headers: &[(String, String)],
    body: &[u8],
) -> ProxySessionRequestGuard {
    begin_tracked_proxy_session(ProxySessionRequest {
        method: &Method::Post,
        path: "/v1/messages",
        headers,
        body,
        remote_address: Some("127.0.0.1:50000".to_string()),
        service_tier: None,
    })
    .unwrap()
    .unwrap()
}

fn remove_anthropic_test_sessions(ids: &[String]) {
    for id in ids {
        proxy_sessions().lock().unwrap().remove(id);
        concurrent_account_router()
            .lock()
            .unwrap()
            .assignments
            .remove(id);
    }
}

#[test]
fn anthropic_message_routes_track_requests_but_token_probes_do_not() {
    let body = anthropic_session_test_body(None);
    for path in ANTHROPIC_MESSAGES_PATHS {
        assert!(tracks_proxy_session(&Method::Post, path, &body));
    }
    assert!(!tracks_proxy_session(&Method::Get, "/v1/messages", &body));
    assert!(!tracks_proxy_session(
        &Method::Post,
        "/v1/messages/count_tokens",
        &body
    ));
    let probe = br#"{"max_tokens":1,"messages":[{"role":"user","content":"hello"}]}"#;
    assert!(!tracks_proxy_session(&Method::Post, "/v1/messages", probe));
}

#[test]
fn anthropic_session_headers_override_metadata() {
    let session_id = format!("anthropic-header-{}", uuid::Uuid::new_v4());
    let headers = vec![("thread-id".to_string(), session_id.clone())];
    let body = anthropic_session_test_body(Some(json!({ "session_id": "other" })));
    let request = tracked_anthropic_test_request(&headers, &body);
    assert_eq!(request.session_id(), session_id);
    drop(request);
    remove_anthropic_test_sessions(&[session_id]);
}

#[test]
fn anthropic_metadata_keeps_conversations_and_agents_distinct_without_exposing_identity() {
    let first = anthropic_session_test_body(Some(json!({
        "user_id": "user_private_account_private_session_conversation-a"
    })));
    let next_turn = first.clone();
    let second = anthropic_session_test_body(Some(json!({
        "user_id": "user_private_account_private_session_conversation-b"
    })));
    let first_id = anthropic_request_session_id(&[], &first);
    assert_eq!(first_id, anthropic_request_session_id(&[], &next_turn));
    assert_ne!(first_id, anthropic_request_session_id(&[], &second));
    assert!(!first_id.contains("private"));
    let agent_body = |agent| {
        anthropic_session_test_body(Some(json!({
            "user_id": json!({ "session_id": "conversation-a", "agent_id": agent }).to_string()
        })))
    };
    assert_ne!(
        anthropic_request_session_id(&[], &agent_body("worker-a")),
        anthropic_request_session_id(&[], &agent_body("worker-b")),
    );
}

#[test]
fn anthropic_session_identity_uses_header_and_valid_metadata_fallbacks() {
    let metadata = json!({
        "session_id": " ", "user_id": "user_test_account_test_session_conversation-fallback"
    });
    let body = anthropic_session_test_body(Some(metadata));
    let fallback = anthropic_metadata_session_identity(&body).unwrap();
    assert!(fallback.ends_with("conversation-fallback"));
    let headers = vec![(
        "x-session-id".to_string(),
        "conversation-header".to_string(),
    )];
    let header_id = anthropic_request_session_id(&headers, &body);
    assert_ne!(header_id, anthropic_request_session_id(&[], &body));
    assert_eq!(header_id, anthropic_request_session_id(&headers, b"{}"));
}

#[test]
fn anthropic_requests_without_conversation_identity_are_not_pinned_to_one_connection() {
    for metadata in [None, Some(json!({ "user_id": "a-shared-api-user" }))] {
        let body = anthropic_session_test_body(metadata);
        let first = tracked_anthropic_test_request(&[], &body);
        let second = tracked_anthropic_test_request(&[], &body);
        assert_ne!(first.session_id(), second.session_id());
        let ids = vec![
            first.session_id().to_string(),
            second.session_id().to_string(),
        ];
        drop((first, second));
        remove_anthropic_test_sessions(&ids);
    }
}

#[test]
fn anthropic_sessions_balance_accounts_and_keep_repeated_turns_sticky() {
    let (root, paths) = concurrent_priority_test_paths();
    let accounts = [
        format!("a-{}", uuid::Uuid::new_v4()),
        format!("b-{}", uuid::Uuid::new_v4()),
    ];
    for id in &accounts {
        add_concurrent_priority_test_account(&paths, id, 0);
    }
    let state = enabled_concurrent_priority_state();
    let first_body = anthropic_session_test_body(Some(
        json!({ "session_id": uuid::Uuid::new_v4().to_string() }),
    ));
    let second_body = anthropic_session_test_body(Some(
        json!({ "session_id": uuid::Uuid::new_v4().to_string() }),
    ));
    let first = tracked_anthropic_test_request(&[], &first_body);
    let second = tracked_anthropic_test_request(&[], &second_body);
    let pick = |guard: &ProxySessionRequestGuard| {
        concurrent_account_for_session(&paths, &state, Some(guard.session_id()))
            .unwrap()
            .unwrap()
    };
    let first_account = pick(&first);
    assert_ne!(first_account, pick(&second));
    let next_turn = tracked_anthropic_test_request(&[], &first_body);
    assert_eq!(first_account, pick(&next_turn));
    mark_proxy_session_concurrent_account(
        Some(first.session_id()),
        &first_account,
        "test@example.invalid",
    );
    assert!(proxy_sessions().lock().unwrap()[first.session_id()].concurrent_routed);
    let ids = vec![
        first.session_id().to_string(),
        second.session_id().to_string(),
    ];
    drop((first, second, next_turn));
    remove_anthropic_test_sessions(&ids);
    assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn anthropic_session_polling_remains_available_while_requests_are_active() {
    let body = anthropic_session_test_body(None);
    let request = tracked_anthropic_test_request(&[], &body);
    let session_id = request.session_id().to_string();
    let (release, wait) = mpsc::channel();
    let worker = thread::spawn(move || {
        wait.recv_timeout(Duration::from_secs(5)).unwrap();
        drop(request);
    });
    for _ in 0..3 {
        assert!(active_proxy_session_ids().unwrap().contains(&session_id));
        let requests = list_proxy_session_requests_blocking(&session_id).unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].response_time_ms.is_none());
    }
    release.send(()).unwrap();
    worker.join().unwrap();
    assert!(!active_proxy_session_ids().unwrap().contains(&session_id));
    remove_anthropic_test_sessions(&[session_id]);
}
