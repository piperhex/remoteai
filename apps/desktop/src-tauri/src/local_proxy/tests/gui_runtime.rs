// The external speed is process-wide; tests that mutate it must not race one another.
static GUI_SPEED_TEST_LOCK: Mutex<()> = Mutex::new(());

struct GuiRuntimeFixture {
    app: tauri::App<tauri::test::MockRuntime>,
    root: PathBuf,
    base_url: String,
}

impl GuiRuntimeFixture {
    fn new(upstream: &Server) -> Self {
        Self::with_app(upstream, breakdown_responsiveness_test_app())
    }

    fn with_app(upstream: &Server, app: tauri::App<tauri::test::MockRuntime>) -> Self {
        app.manage(crate::codex_gui::GuiState::default());
        app.manage(crate::codex_gui::web::WebEventState::default());
        let paths = resolve_paths(app.handle()).unwrap();
        let root = paths.state_file.parent().unwrap().to_path_buf();
        let mut provider = openai_provider(format!("http://{}/v1", upstream.server_addr()));
        provider.id = "gui-runtime".into();
        provider.kind = ProviderKind::Custom;
        crate::storage::write_json_atomic(
            &paths.providers.join("gui-runtime.json"),
            &serde_json::to_value(provider).unwrap(),
        )
        .unwrap();
        write_state(
            &paths,
            &ManagerStateFile {
                active_provider_id: Some("gui-runtime".into()),
                local_proxy_listen_on_all_interfaces: true,
                local_proxy_lan_api_key: Some("external-key".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let base_url = gui_runtime::ensure_started(app.handle()).unwrap();
        Self {
            app,
            root,
            base_url,
        }
    }

    fn speed(&self, enabled: bool) {
        tauri::async_runtime::block_on(gui_runtime::codex_gui_set_fast_mode(
            self.app.handle().clone(),
            enabled,
        ))
        .unwrap();
    }

    fn external_listener(&self) -> String {
        let server = Arc::new(Server::http("127.0.0.1:0").unwrap());
        let base = format!("http://{}/v1", server.server_addr());
        let incoming = Arc::clone(&server);
        let app = self.app.handle().clone();
        let handle = thread::spawn(move || {
            for request in incoming.incoming_requests() {
                let app = app.clone();
                thread::spawn(move || handle_request(app, request));
            }
        });
        *runtime().lock().unwrap() = Some(ProxyRuntime {
            server,
            handle: Some(handle),
        });
        base
    }
}

impl Drop for GuiRuntimeFixture {
    fn drop(&mut self) {
        stop_server();
        gui_runtime::shutdown(self.app.handle());
        set_proxy_service_tier(ProxyServiceTier::Default);
        assert!(self
            .root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("com.codex-switch.breakdown-test."));
        if let Err(error) = fs::remove_dir_all(&self.root) {
            eprintln!("GUI runtime fixture cleanup failed: {error}");
        }
    }
}

fn gui_runtime_client() -> Client {
    Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap()
}

fn runtime_request(base: &str, id: &str) -> Value {
    gui_runtime_client()
        .post(format!("{base}/responses"))
        .bearer_auth(crate::codex_config::LOCAL_PROXY_TOKEN)
        .header("thread-id", id)
        .json(&json!({"model": "gpt-5.6-sol", "input": id, "stream": false}))
        .send()
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .unwrap()
}

fn runtime_upstream_reply(request: Request, tier: &str) {
    request.respond(Response::from_string(json!({
        "id": uuid::Uuid::new_v4().to_string(), "model": "gpt-5.6-sol", "output": [],
        "service_tier": tier, "usage": {"input_tokens": 8, "output_tokens": 2, "total_tokens": 10}
    }).to_string()).with_header(Header::from_bytes("Content-Type", "application/json").unwrap())).unwrap();
}

#[test]
fn gui_transport_runs_without_external_proxy_and_keeps_speed_usage_and_polling_independent() {
    let _guard = GUI_SPEED_TEST_LOCK.lock().unwrap();
    let upstream = Server::http("127.0.0.1:0").unwrap();
    let fixture = GuiRuntimeFixture::new(&upstream);
    assert!(!is_running());
    assert!(!read_state(&resolve_paths(fixture.app.handle()).unwrap()).local_proxy_enabled);
    assert!(fixture.base_url.starts_with("http://127.0.0.1:"));
    assert_eq!(
        gui_runtime::ensure_started(fixture.app.handle()).unwrap(),
        fixture.base_url
    );
    verify_gui_speed_uses_selected_provider(&fixture);
    let (seen_tx, seen) = mpsc::channel();
    let (release, release_rx) = mpsc::channel();
    let upstream_worker = thread::spawn(move || {
        for index in 0..5 {
            let mut request = upstream
                .recv_timeout(Duration::from_secs(10))
                .unwrap()
                .unwrap();
            let body: Value = serde_json::from_reader(request.as_reader()).unwrap();
            let tier = body["service_tier"].as_str().unwrap();
            seen_tx.send(tier.to_owned()).unwrap();
            if index == 0 {
                release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            }
            runtime_upstream_reply(request, tier);
        }
    });
    fixture.speed(true);
    let base = fixture.base_url.clone();
    let id = format!("gui-private-{}", uuid::Uuid::new_v4());
    let request_id = id.clone();
    let in_flight = thread::spawn(move || runtime_request(&base, &request_id));
    assert_eq!(
        seen.recv_timeout(Duration::from_secs(10)).unwrap(),
        "priority"
    );
    verify_gui_polling_and_switches(&fixture, &id);
    release.send(()).unwrap();
    assert_eq!(in_flight.join().unwrap()["service_tier"], "priority");
    verify_runtime_requests_and_usage(&fixture, &seen);
    upstream_worker.join().unwrap();
}

fn verify_gui_speed_uses_selected_provider(fixture: &GuiRuntimeFixture) {
    let app = fixture.app.handle();
    fixture.speed(false);
    let paths = resolve_paths(app).unwrap();
    let mut shared = read_state(&paths);
    let original = shared.clone();
    shared.active_provider_id = Some("unavailable-external-provider".into());
    write_state(&paths, &shared).unwrap();
    fixture.speed(true);
    let mut provider = providers::read_provider(&paths, "gui-runtime").unwrap();
    provider.fast_mode_enabled = false;
    let file = paths.providers.join("gui-runtime.json");
    crate::storage::write_json_atomic(&file, &serde_json::to_value(&provider).unwrap()).unwrap();
    fixture.speed(false);
    assert!(
        tauri::async_runtime::block_on(gui_runtime::codex_gui_set_fast_mode(app.clone(), true))
            .is_err()
    );
    provider.fast_mode_enabled = true;
    crate::storage::write_json_atomic(&file, &serde_json::to_value(provider).unwrap()).unwrap();
    write_state(&paths, &original).unwrap();
}

fn verify_gui_polling_and_switches(fixture: &GuiRuntimeFixture, id: &str) {
    let app = fixture.app.handle();
    let external = fixture.external_listener();
    set_proxy_service_tier(ProxyServiceTier::Priority);
    fixture.speed(false);
    assert_eq!(proxy_service_tier(), ProxyServiceTier::Priority);
    for tier in [ProxyServiceTier::Priority, ProxyServiceTier::Ultrafast, ProxyServiceTier::Default] {
        let changed = tauri::async_runtime::block_on(set_local_proxy_service_tier(app.clone(), tier)).unwrap();
        assert_eq!(changed.service_tier, tier);
        assert_eq!(serde_json::to_value(&changed).unwrap()["serviceTier"], tier.as_str());
        assert_proxy_speed_matches_forwarded_requests(tier.as_str());
        let status = tauri::async_runtime::block_on(get_local_proxy_status(app.clone())).unwrap();
        assert!(status.running);
        assert_eq!(status.fast_mode_enabled, tier != ProxyServiceTier::Default);
        assert_eq!(gui_runtime::service_tier(app), ProxyServiceTier::Default);
        let sessions = tauri::async_runtime::block_on(list_proxy_sessions(app.clone())).unwrap();
        assert!(sessions
            .iter()
            .any(|session| session.id == id && session.active_requests == 1));
        tauri::async_runtime::block_on(gui_runtime::codex_gui_request_settings(app.clone()))
            .unwrap();
    }
    stop_server();
    assert!(!is_running());
    assert!(tauri::async_runtime::block_on(set_local_proxy_service_tier(
        app.clone(), ProxyServiceTier::Ultrafast,
    )).is_err());
    assert!(gui_runtime_client()
        .get(format!("{external}/models"))
        .send()
        .is_err());
    assert_eq!(gui_runtime::service_tier(app), ProxyServiceTier::Default);
}

fn verify_runtime_requests_and_usage(fixture: &GuiRuntimeFixture, seen: &mpsc::Receiver<String>) {
    assert_eq!(
        runtime_request(&fixture.base_url, "gui-normal")["service_tier"],
        "default"
    );
    assert_eq!(
        seen.recv_timeout(Duration::from_secs(10)).unwrap(),
        "default"
    );
    let external = fixture.external_listener();
    set_proxy_service_tier(ProxyServiceTier::Priority);
    assert_eq!(
        runtime_request(&external, "external-fast")["service_tier"],
        "priority"
    );
    assert_eq!(
        seen.recv_timeout(Duration::from_secs(10)).unwrap(),
        "priority"
    );
    fixture.speed(true);
    set_proxy_service_tier(ProxyServiceTier::Default);
    assert_eq!(
        runtime_request(&fixture.base_url, "gui-fast")["service_tier"],
        "priority"
    );
    assert_eq!(
        seen.recv_timeout(Duration::from_secs(10)).unwrap(),
        "priority"
    );
    verify_ultrafast_request(fixture, seen);
    let entries = load_token_usage_summary_entries(fixture.app.handle(), 0).unwrap();
    assert_eq!(entries.len(), 5);
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.total_tokens.unwrap())
            .sum::<u64>(),
        50
    );
    assert_eq!(
        entries
            .iter()
            .filter(|entry| entry.service_tier.as_deref() == Some("priority"))
            .count(),
        3
    );
}

fn verify_ultrafast_request(fixture: &GuiRuntimeFixture, seen: &mpsc::Receiver<String>) {
    use super::gui_speed::GuiRequestSpeed;
    let app = fixture.app.handle();
    let settings = tauri::async_runtime::block_on(gui_runtime::codex_gui_set_request_speed(
        app.clone(),
        GuiRequestSpeed::Ultrafast,
    ))
    .unwrap();
    assert_eq!(
        serde_json::to_value(settings).unwrap()["speed"],
        "ultrafast"
    );
    assert_eq!(proxy_service_tier(), ProxyServiceTier::Default);
    assert_eq!(
        runtime_request(&fixture.base_url, "gui-ultrafast")["service_tier"],
        "ultrafast"
    );
    assert_eq!(
        seen.recv_timeout(Duration::from_secs(10)).unwrap(),
        "ultrafast"
    );
    fixture.speed(false);
    assert_eq!(gui_runtime::service_tier(app), ProxyServiceTier::Default);
}

#[test]
fn gui_endpoint_is_private_and_cannot_be_used_as_an_external_proxy() {
    let headers = vec![(
        "Authorization".into(),
        format!("Bearer {}", crate::codex_config::LOCAL_PROXY_TOKEN),
    )];
    let gui = "/codex-gui/v1/responses";
    assert!(request_origin_allowed(
        RequestOrigin::Gui,
        gui,
        &headers,
        true
    ));
    assert!(!request_origin_allowed(
        RequestOrigin::Gui,
        gui,
        &headers,
        false
    ));
    assert!(!request_origin_allowed(RequestOrigin::Gui, gui, &[], true));
    assert!(!request_origin_allowed(
        RequestOrigin::Gui,
        "/v1/responses",
        &headers,
        true
    ));
    assert!(!request_origin_allowed(
        RequestOrigin::External,
        gui,
        &headers,
        true
    ));
    assert!(!request_origin_allowed(
        RequestOrigin::External,
        gui,
        &headers,
        false
    ));
    assert!(request_origin_allowed(
        RequestOrigin::External,
        "/v1/responses",
        &headers,
        false
    ));
}
