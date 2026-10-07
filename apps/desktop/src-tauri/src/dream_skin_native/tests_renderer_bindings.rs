use super::*;

#[test]
fn publishes_language_before_a_usage_query_fails() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let (published, received) = std::sync::mpsc::channel();
    let server = thread::spawn(move || capture_language_publication(listener, published));
    let target = CdpTarget {
        id: "language-test".to_string(),
        kind: "page".to_string(),
        url: "app://-/index.html".to_string(),
        web_socket_debugger_url: format!("ws://127.0.0.1:{port}/devtools/page/language-test"),
    };
    let result = publish_usage_with_language(&target, port, Some("ru"), || {
        // The renderer must already have the preference when slow/failing accounting starts.
        assert_eq!(
            received.try_recv().unwrap(),
            "window.__CODEX_SWITCH_SPEED_SELECTOR__?.updateLanguage?.(\"ru\")"
        );
        Err("simulated accounting read failure".to_string())
    });
    assert_eq!(result.unwrap_err(), "simulated accounting read failure");
    server.join().unwrap();
}

fn capture_language_publication(listener: TcpListener, published: std::sync::mpsc::Sender<String>) {
    let (stream, _) = listener.accept().unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut socket = tungstenite::accept(stream).unwrap();
    for method in ["Runtime.enable", "Page.enable", "Runtime.evaluate"] {
        let request = socket.read().unwrap();
        let request: Value = serde_json::from_str(request.to_text().unwrap()).unwrap();
        assert_eq!(request["method"], method);
        if method == "Runtime.evaluate" {
            published
                .send(
                    request["params"]["expression"]
                        .as_str()
                        .unwrap()
                        .to_string(),
                )
                .unwrap();
        }
        socket
            .send(Message::Text(
                json!({
                    "id": request["id"], "result": { "result": { "value": true } }
                })
                .to_string()
                .into(),
            ))
            .unwrap();
    }
}

#[test]
fn usage_request_arriving_before_setup_acknowledgement_is_preserved() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut socket = tungstenite::accept(stream).unwrap();
        let request = socket.read().unwrap();
        let request: Value = serde_json::from_str(request.to_text().unwrap()).unwrap();
        socket
            .send(Message::Text(
                json!({
                    "method": "Runtime.bindingCalled",
                    "params": { "name": USAGE_SUMMARY_BINDING, "payload": "refresh" }
                })
                .to_string()
                .into(),
            ))
            .unwrap();
        socket
            .send(Message::Text(
                json!({
                    "id": request["id"], "result": { "result": { "value": true } }
                })
                .to_string()
                .into(),
            ))
            .unwrap();
    });
    let target = CdpTarget {
        id: "usage-test".to_string(),
        kind: "page".to_string(),
        url: "app://-/index.html".to_string(),
        web_socket_debugger_url: format!("ws://127.0.0.1:{port}/devtools/page/usage-test"),
    };
    let mut session = CdpSession::connect(&target, port).unwrap();
    assert_eq!(session.evaluate("true").unwrap(), json!(true));
    let call = session.read_renderer_binding().unwrap().unwrap();
    assert_eq!(call.name, USAGE_SUMMARY_BINDING);
    assert_eq!(call.payload, "refresh");
    assert!(session.pending_bindings.is_empty());
    server.join().unwrap();
}

#[test]
fn unrelated_renderer_events_do_not_starve_usage_publication() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut socket = tungstenite::accept(stream).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            let event = json!({ "method": "Runtime.consoleAPICalled", "params": {} });
            if socket
                .send(Message::Text(event.to_string().into()))
                .is_err()
            {
                break; // The client closes as soon as its bounded poll finishes.
            }
            thread::sleep(Duration::from_millis(10));
        }
    });
    let target = CdpTarget {
        id: "usage-busy-test".to_string(),
        kind: "page".to_string(),
        url: "app://-/index.html".to_string(),
        web_socket_debugger_url: format!("ws://127.0.0.1:{port}/devtools/page/usage-busy-test"),
    };
    let mut session = CdpSession::connect(&target, port).unwrap();
    assert!(session.read_renderer_binding().unwrap().is_none());
    drop(session);
    server.join().unwrap();
}
