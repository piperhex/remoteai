fn gui_error_test_app(base_url: String) -> tauri::App<tauri::test::MockRuntime> {
    let app = breakdown_responsiveness_test_app();
    let paths = resolve_paths(app.handle()).unwrap();
    let mut provider = openai_provider(base_url);
    provider.id = "gui-error-provider".into();
    crate::storage::write_json_atomic(
        &paths.providers.join("gui-error-provider.json"),
        &serde_json::to_value(provider).unwrap(),
    )
    .unwrap();
    crate::storage::write_json_atomic(
        &paths
            .state_file
            .parent()
            .unwrap()
            .join("codex-gui-account.json"),
        &json!({"kind":"provider","id":"gui-error-provider"}),
    )
    .unwrap();
    app
}

fn close_during_tls_handshake() -> (String, thread::JoinHandle<()>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("https://{}", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "TLS client did not connect");
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("TLS test accept failed: {error}"),
            }
        };
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut header = [0; 5];
        stream.read_exact(&mut header).unwrap();
        assert_eq!(header[0], 22, "expected a TLS handshake record");
        let mut hello = vec![0; u16::from_be_bytes([header[3], header[4]]) as usize];
        stream.read_exact(&mut hello).unwrap();
        stream.shutdown(std::net::Shutdown::Both).unwrap();
    });
    (url, server)
}

#[test]
fn gui_tls_disconnect_keeps_diagnostics_and_returns_a_safe_specific_message() {
    let (url, upstream) = close_during_tls_handshake();
    let app = gui_error_test_app(url);
    let paths = resolve_paths(app.handle()).unwrap();
    let root = paths.state_file.parent().unwrap();
    let log = diagnostic_log_path(app.handle()).unwrap();
    let error = {
        let _scope = DiagnosticScope::enter(log.clone());
        handle_proxy_request(
            app.handle(),
            &Method::Post,
            "/codex-gui/v1/responses",
            &[],
            br#"{"model":"test","input":"hello"}"#.to_vec(),
            None,
            None,
        )
        .err()
        .expect("TLS disconnect must fail the GUI request")
    };
    upstream.join().unwrap();
    assert!(error.contains("安全连接尚未建立就被断开"), "{error}");
    assert!(!error.contains("所选账户"));
    assert_eq!(upstream_error_message(&error), error);
    let diagnostics = fs::read_to_string(log).unwrap();
    assert!(diagnostics.contains("tls handshake eof"), "{diagnostics}");
    assert!(diagnostics.contains("gui_request_failed"));
    assert!(!diagnostics.contains("sk-upstream"));
    assert!(diagnostics.contains("https://127.0.0.1"));
    // The mock application identifier owns this unique directory.
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("com.codex-switch.breakdown-test."));
    fs::remove_dir_all(root).unwrap();
}
