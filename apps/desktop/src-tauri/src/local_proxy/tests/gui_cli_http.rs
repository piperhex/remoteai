#[test]
fn cli_messages_use_gui_provider_credentials_and_preserve_gui_model() {
    let app = breakdown_responsiveness_test_app();
    app.manage(crate::codex_gui::web::WebEventState::default());
    let paths = resolve_paths(app.handle()).unwrap();
    let root = paths.state_file.parent().unwrap().to_path_buf();
    let server = Server::http("127.0.0.1:0").unwrap();
    let mut provider = openai_provider(format!("http://{}", server.server_addr().to_ip().unwrap()));
    provider.id = "cli-gui-provider".into();
    provider.api_key = "gui-provider-credential".into();
    provider.api_format = ProviderApiFormat::OpenaiResponses;
    provider.model = "team-model".into();
    provider.models = vec!["team-model".into()];
    crate::storage::write_json_atomic(&paths.providers.join("cli-gui-provider.json"),
        &serde_json::to_value(&provider).unwrap()).unwrap();
    crate::storage::write_json_atomic(&root.join("codex-gui-account.json"),
        &json!({"kind":"provider", "id":"cli-gui-provider"})).unwrap();
    write_state(&paths, &ManagerStateFile {
        active_provider_id: Some("unrelated-main-provider".into()), ..Default::default()
    }).unwrap();
    let upstream = thread::spawn(move || {
        let mut request = server.recv_timeout(Duration::from_secs(10)).unwrap().unwrap();
        assert_eq!(request.headers().iter().find(|header| header.field.equiv("Authorization"))
            .unwrap().value.as_str(), "Bearer gui-provider-credential");
        let body: Value = serde_json::from_reader(request.as_reader()).unwrap();
        assert_eq!(body["model"], "team-model");
        assert_eq!(body["input"][0]["content"][0]["text"], "hello from CLI");
        request.respond(Response::from_string(json!({"id":"response-cli", "status":"completed",
            "output":[{"type":"message", "role":"assistant", "content":[{"type":"output_text",
                "text":"Account route works"}]}], "usage":{"input_tokens":5,"output_tokens":4}}).to_string())
            .with_header(Header::from_bytes("content-type", "application/json").unwrap())).unwrap();
    });
    let payload = handle_proxy_request(app.handle(), &Method::Post, "/codex-gui/v1/messages", &[],
        json!({"model":"team-model", "max_tokens":200, "stream":false,
            "messages":[{"role":"user","content":"hello from CLI"}]}).to_string().into_bytes(),
        None, None).unwrap();
    assert_eq!(payload.status, 200);
    let body = read_upstream_payload(payload);
    assert!(String::from_utf8_lossy(&body).contains("Account route works"));
    upstream.join().unwrap();
    assert_eq!(read_state(&paths).active_provider_id.as_deref(), Some("unrelated-main-provider"));
    assert!(root.file_name().unwrap().to_string_lossy().starts_with("com.codex-switch.breakdown-test."));
    fs::remove_dir_all(root).unwrap();
}
