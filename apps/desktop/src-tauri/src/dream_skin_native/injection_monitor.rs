fn runtime_proxy_running() -> bool {
    crate::local_proxy::is_running()
}

fn runtime_enhancements_enabled() -> bool {
    crate::client_integration::enabled_for(runtime_proxy_running())
}

fn ensure_skin_allowed() -> Result<(), String> {
    if runtime_enhancements_enabled() {
        return Ok(());
    }
    Err("请先在设置中开启「ChatGPT 增强功能」，再使用皮肤。".to_string())
}

fn is_skin_surface_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    let is_avatar_route =
        |route: &str| route == "/avatar-overlay" || route.starts_with("/avatar-overlay/");
    url.scheme() == "app"
        && !url
            .path()
            .ends_with("/avatar-overlay-composition-surface.html")
        && !is_avatar_route(url.path())
        && !url
            .query_pairs()
            .any(|(key, route)| key == "initialRoute" && is_avatar_route(&route))
}

fn inject_target(
    target: &CdpTarget,
    port: u16,
    payload: &LoadedPayload,
    previous_script: Option<&str>,
) -> Result<Option<InjectedTarget>, String> {
    let mut session = CdpSession::connect(target, port)?;
    session.enable()?;
    if let Some(identifier) = previous_script {
        session.remove_early(identifier);
    }
    let early = early_payload(payload);
    let early_script_id = session.register_early(&early)?;
    let result = apply_skin_in_session(&mut session, payload, &early);

    match result {
        Ok(true) => Ok(Some(InjectedTarget {
            revision: payload.revision.clone(),
            early_script_id,
        })),
        Ok(false) => {
            if let Some(identifier) = early_script_id.as_deref() {
                session.remove_early(identifier);
            }
            // A published CDP page can precede the React shell by several seconds.
            // Leave it pending so the monitor retries when the shell is ready.
            Ok(None)
        }
        Err(error) => {
            if let Some(identifier) = early_script_id.as_deref() {
                session.remove_early(identifier);
            }
            Err(error)
        }
    }
}

fn apply_skin_in_session(
    session: &mut CdpSession,
    payload: &LoadedPayload,
    early: &str,
) -> Result<bool, String> {
    const SHELL_PROBE_TIMEOUT: Duration = Duration::from_millis(1800);
    session.evaluate(early)?;
    if !wait_for_codex_probe(session, SHELL_PROBE_TIMEOUT)? {
        return Ok(false);
    }
    let revision_json =
        serde_json::to_string(&payload.revision).map_err(|error| error.to_string())?;
    let early_applied = session.evaluate(&format!(
        "window.__CODEX_DREAM_SKIN_EARLY_APPLIED__ === {revision_json}"
    ))?;
    if early_applied.as_bool() != Some(true) {
        let fallback_generation = serde_json::to_string(&format!("fallback:{}", payload.revision))
            .map_err(|error| error.to_string())?;
        session.evaluate(&format!(
            "window.__CODEX_DREAM_SKIN_EARLY_GENERATION__ = {fallback_generation}"
        ))?;
        session.evaluate(&payload.source)?;
        session.evaluate(&format!("window.__CODEX_DREAM_SKIN_EARLY_APPLIED__ = {revision_json}"))?;
    }
    let verification = session.evaluate(VERIFY_PAYLOAD)?;
    if verification.get("pass").and_then(Value::as_bool) != Some(true) {
        return Err(format!(
            "Dream Skin target verification failed: {verification}"
        ));
    }
    Ok(true)
}

fn refresh_skin_target(
    target: &CdpTarget,
    port: u16,
    payload: &LoadedPayload,
    injected: &mut HashMap<String, InjectedTarget>,
) -> Result<(), String> {
    if !is_skin_surface_url(&target.url) {
        return Ok(());
    }
    let current = injected.get(&target.id);
    if current.is_some_and(|entry| entry.revision == payload.revision) {
        return Ok(());
    }
    let previous_script = current.and_then(|entry| entry.early_script_id.as_deref());
    if let Some(next) = inject_target(target, port, payload, previous_script)? {
        injected.insert(target.id.clone(), next);
    } else {
        injected.remove(&target.id);
    }
    Ok(())
}

fn remove_target(
    target: &CdpTarget,
    port: u16,
    previous_script: Option<&str>,
) -> Result<(), String> {
    let mut session = CdpSession::connect(target, port)?;
    session.enable()?;
    if let Some(identifier) = previous_script {
        session.remove_early(identifier);
    }
    session.evaluate(REMOVE_PAYLOAD)?;
    Ok(())
}

#[derive(Default)]
struct RendererMonitorState {
    injected: HashMap<String, InjectedTarget>,
    last_port: Option<u16>,
    recovery: RendererRecovery,
    last_sync_check: Option<Instant>,
}

fn monitor_iteration(
    paths: &RuntimePaths,
    monitor: &mut RendererMonitorState,
) -> Result<(), String> {
    let RendererMonitorState {
        injected,
        last_port,
        recovery,
        last_sync_check,
    } = monitor;
    let skin_enabled = marker_path()?.is_file();
    let state = read_session();
    let Some(port) = state.port else {
        injected.clear();
        *last_port = None;
        recovery.reset();
        *last_sync_check = None;
        return Ok(());
    };
    if *last_port != Some(port) {
        injected.clear();
        *last_port = Some(port);
        *last_sync_check = None;
    }
    let paused = !runtime_enhancements_enabled() || !skin_enabled || pause_path()?.is_file();
    let payload = if paused {
        None
    } else {
        Some(load_payload(paths)?)
    };
    let targets = match list_targets(port) {
        Ok(targets) => {
            recovery.reset();
            targets
        }
        Err(error) if error.contains("CDP is unavailable") => {
            recover_after_outage(paths, &state, recovery)?;
            return Ok(());
        }
        Err(error) => {
            recovery.reset();
            return Err(error);
        }
    };
    maintain_renderer_sync(&targets, port, last_sync_check);
    injected.retain(|id, _| targets.iter().any(|target| &target.id == id));
    for target in targets {
        refresh_monitored_skin(&target, port, payload.as_ref(), injected)?;
    }
    Ok(())
}

fn refresh_monitored_skin(
    target: &CdpTarget,
    port: u16,
    payload: Option<&LoadedPayload>,
    injected: &mut HashMap<String, InjectedTarget>,
) -> Result<(), String> {
    if let Some(payload) = payload {
        if let Err(error) = refresh_skin_target(target, port, payload, injected) {
            eprintln!("Dream Skin target {}: {error}", target.id);
        }
        return Ok(());
    }
    let current = injected.get(&target.id);
    if current.is_some_and(|entry| entry.revision == "paused") {
        return Ok(());
    }
    remove_target(
        target,
        port,
        current.and_then(|entry| entry.early_script_id.as_deref()),
    )?;
    injected.insert(
        target.id.clone(),
        InjectedTarget {
            revision: "paused".to_string(),
            early_script_id: None,
        },
    );
    Ok(())
}

fn monitor_loop(control: Arc<MonitorControl>) {
    let mut monitor = RendererMonitorState::default();
    loop {
        let paths = {
            let guard = control
                .paths
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            let (guard, _) = control
                .wake
                .wait_timeout(guard, Duration::from_millis(250))
                .unwrap_or_else(|error| error.into_inner());
            guard.clone()
        };
        let Some(paths) = paths else {
            continue;
        };
        if let Err(error) = monitor_iteration(&paths, &mut monitor) {
            if !error.contains("CDP is unavailable") {
                eprintln!("Codex renderer monitor: {error}");
            }
        }
    }
}

fn ensure_monitor(paths: RuntimePaths) {
    let control = MONITOR.get_or_init(|| {
        let control = Arc::new(MonitorControl {
            paths: Mutex::new(None),
            wake: Condvar::new(),
        });
        let background = Arc::clone(&control);
        thread::Builder::new()
            .name("codex-renderer-monitor".to_string())
            .spawn(move || monitor_loop(background))
            .expect("failed to start Codex renderer monitor");
        control
    });
    *control
        .paths
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(paths);
    control.wake.notify_all();
}

fn wake_monitor() {
    if let Some(control) = MONITOR.get() {
        control.wake.notify_all();
    }
}

fn verification_succeeded(results: &[Value], expected_revision: Option<&str>) -> bool {
    results.iter().any(|entry| {
        let result = &entry["result"];
        result["pass"].as_bool() == Some(true)
            && expected_revision.is_none_or(|revision| result["revision"].as_str() == Some(revision))
    })
}

fn verification_timeout_reason(last_error: &str, results: &[Value]) -> String {
    if results.iter().any(|entry| entry.get("result").is_some()) {
        "the skin could not be confirmed in the Codex window".to_string()
    } else if !last_error.is_empty() {
        last_error.to_string()
    } else {
        "no Codex main window was ready for verification".to_string()
    }
}

fn wait_for_verified(port: u16, timeout: Duration, expected_revision: Option<&str>) -> Result<Vec<Value>, String> {
    let deadline = Instant::now() + timeout;
    let mut last_results = Vec::new();
    let mut last_error = String::new();
    while Instant::now() < deadline {
        match list_targets(port) {
            Ok(targets) => {
                last_results.clear();
                last_error.clear();
                for target in targets
                    .into_iter()
                    .filter(|target| is_workspace_page(&target.url))
                {
                    match CdpSession::connect(&target, port).and_then(|mut session| {
                        session.enable()?;
                        let probe = session.evaluate(CODEX_PROBE_PAYLOAD)?;
                        if !codex_probe_succeeded(&probe) {
                            return Ok(None);
                        }
                        session.evaluate(VERIFY_PAYLOAD).map(Some)
                    }) {
                        Ok(Some(value)) => last_results.push(json!({
                            "targetId": target.id,
                            "result": value,
                        })),
                        Ok(None) => {}
                        Err(error) => last_error = error,
                    }
                }
                if verification_succeeded(&last_results, expected_revision) {
                    return Ok(last_results);
                }
            }
            Err(error) => last_error = error,
        }
        thread::sleep(Duration::from_millis(400));
    }
    let reason = verification_timeout_reason(&last_error, &last_results);
    Err(format!(
        "Dream Skin verification timed out: {}; last result: {}",
        reason,
        serde_json::to_string(&last_results).unwrap_or_default()
    ))
}

fn select_port() -> Result<u16, String> {
    for port in DEFAULT_CDP_PORT..=DEFAULT_CDP_PORT + 100 {
        if TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok() {
            return Ok(port);
        }
    }
    Err("No free local CDP port was found between 9335 and 9435.".to_string())
}

fn path_eq(left: &Path, right: &Path) -> bool {
    #[cfg(target_os = "windows")]
    return windows_path_key(left).eq_ignore_ascii_case(&windows_path_key(right));
    #[cfg(not(target_os = "windows"))]
    return left == right;
}
