fn set_local_proxy_enabled(paths: &Paths, enabled: bool) -> Result<(), String> {
    let mut state = read_state(paths);
    state.local_proxy_enabled = enabled;
    write_state(paths, &state)
}

/// Wire values shared by external proxy settings and upstream request bodies.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ProxyServiceTier {
    #[default]
    Default,
    Priority,
    Ultrafast,
}

impl ProxyServiceTier {
    fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Priority => "priority",
            Self::Ultrafast => "ultrafast",
        }
    }
}

static PROXY_SERVICE_TIER: OnceLock<RwLock<ProxyServiceTier>> = OnceLock::new();

fn proxy_service_tier() -> ProxyServiceTier {
    PROXY_SERVICE_TIER
        .get_or_init(|| RwLock::new(ProxyServiceTier::default()))
        .read()
        .map(|tier| *tier)
        .unwrap_or_default()
}

pub(crate) fn proxy_service_tier_name() -> &'static str {
    proxy_service_tier().as_str()
}

fn set_proxy_service_tier(tier: ProxyServiceTier) {
    if let Ok(mut current) = PROXY_SERVICE_TIER
        .get_or_init(|| RwLock::new(ProxyServiceTier::default()))
        .write()
    {
        *current = tier;
    }
}

#[cfg(test)]
fn parse_proxy_service_tier(value: &Value) -> Result<ProxyServiceTier, &'static str> {
    parse_proxy_service_tier_name(value.get("service_tier").and_then(Value::as_str))
}

fn parse_proxy_service_tier_name(value: Option<&str>) -> Result<ProxyServiceTier, &'static str> {
    match value {
        Some("default") => Ok(ProxyServiceTier::Default),
        Some("priority" | "fast") => Ok(ProxyServiceTier::Priority),
        Some("ultrafast") => Ok(ProxyServiceTier::Ultrafast),
        _ => Err("service_tier must be default, priority, fast or ultrafast"),
    }
}

fn effective_proxy_service_tier(
    body: &[u8],
    override_tier: Option<ProxyServiceTier>,
) -> Option<ProxyServiceTier> {
    if override_tier.is_some() {
        return override_tier;
    }
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return None;
    };
    match value.get("service_tier").and_then(Value::as_str) {
        None => Some(ProxyServiceTier::Default),
        value => parse_proxy_service_tier_name(value).ok(),
    }
}

pub(crate) fn set_proxy_service_tier_by_name(value: &str) -> bool {
    let Ok(tier) = parse_proxy_service_tier_name(Some(value)) else {
        return false;
    };
    set_proxy_service_tier(tier);
    true
}

fn update_proxy_service_tier_for_openai_auth(account_id: Option<&str>) -> bool {
    if account_id.is_none() || proxy_service_tier() == ProxyServiceTier::Default {
        return false;
    }
    set_proxy_service_tier(ProxyServiceTier::Default);
    true
}

fn start_server<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let mut guard = runtime()
        .lock()
        .map_err(|_| "Local proxy runtime lock is poisoned".to_string())?;
    if guard.is_some() {
        return Ok(false);
    }
    set_proxy_service_tier(ProxyServiceTier::default());

    let state = read_state(&resolve_paths(&app)?);
    set_system_prompt_filter_runtime_config(
        state.system_prompt_filter_enabled,
        state.system_prompt_filter_rules.clone(),
    );
    set_system_prompt_injection_runtime_config(
        state.system_prompt_injection_enabled,
        state.system_prompt_injection_prompts.clone(),
    );
    let bind_addr = format!(
        "{}:{LOCAL_PROXY_PORT}",
        proxy_bind_host(lan_listening_enabled(&state))
    );
    let server = Arc::new(bind_http_server(&bind_addr)?);
    let server_for_thread = server.clone();
    let handle = thread::Builder::new()
        .name("codex-switch-local-proxy".to_string())
        .spawn(move || {
            for request in server_for_thread.incoming_requests() {
                let request_app = app.clone();
                let _ = thread::Builder::new()
                    .name("codex-switch-local-proxy-request".to_string())
                    .spawn(move || handle_request(request_app, request));
            }
        })
        .map_err(|error| format!("Failed to spawn local proxy thread: {error}"))?;
    *guard = Some(ProxyRuntime {
        server,
        handle: Some(handle),
    });
    Ok(true)
}

fn proxy_bind_host(listen_on_all_interfaces: bool) -> &'static str {
    if listen_on_all_interfaces {
        LOCAL_PROXY_LAN_HOST
    } else {
        LOCAL_PROXY_HOST
    }
}

fn configured_lan_api_key(state: &ManagerStateFile) -> Option<&str> {
    state
        .local_proxy_lan_api_keys
        .iter()
        .find(|key| key.enabled && !key.api_key.trim().is_empty())
        .map(|key| key.api_key.as_str())
        .or_else(|| {
            state
                .local_proxy_lan_api_key
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
}

fn lan_listening_enabled(state: &ManagerStateFile) -> bool {
    state.local_proxy_listen_on_all_interfaces && configured_lan_api_key(state).is_some()
}

fn bind_http_server(bind_addr: &str) -> Result<Server, String> {
    let deadline = Instant::now() + LOCAL_PROXY_REBIND_RETRY_TIMEOUT;
    loop {
        match Server::http(bind_addr) {
            Ok(server) => return Ok(server),
            Err(error) => {
                let address_in_use = is_address_in_use(error.as_ref());
                if !address_in_use || Instant::now() >= deadline {
                    return Err(format!(
                        "Failed to start local proxy at {bind_addr}: {error}"
                    ));
                }
                thread::sleep(LOCAL_PROXY_REBIND_RETRY_INTERVAL);
            }
        }
    }
}

fn is_address_in_use(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current = Some(error);
    while let Some(error) = current {
        if error
            .downcast_ref::<io::Error>()
            .is_some_and(|error| error.kind() == io::ErrorKind::AddrInUse)
        {
            return true;
        }
        current = error.source();
    }
    false
}

fn listener_wake_address(server: &Server) -> Option<SocketAddr> {
    server.server_addr().to_ip().map(|address| {
        let ip = match address.ip() {
            IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
            IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
            ip => ip,
        };
        SocketAddr::new(ip, address.port())
    })
}

fn stop_proxy_runtime(mut proxy_runtime: ProxyRuntime) {
    proxy_runtime.server.unblock();
    if let Some(handle) = proxy_runtime.handle.take() {
        let _ = handle.join();
    }

    // tiny_http owns the listening socket in an internal accept thread. Its
    // Server::drop wake-up connects to the bound address, which does not
    // reliably wake a 0.0.0.0 listener on Windows. Arrange an explicit
    // loopback connection after drop sets the close flag, then wait for it.
    let wake = listener_wake_address(&proxy_runtime.server).and_then(|address| {
        let (sender, receiver) = std::sync::mpsc::channel();
        thread::Builder::new()
            .name("codex-switch-local-proxy-shutdown".to_string())
            .spawn(move || {
                if receiver.recv().is_ok() {
                    if let Ok(stream) =
                        TcpStream::connect_timeout(&address, Duration::from_millis(100))
                    {
                        let _ = stream.shutdown(Shutdown::Both);
                    }
                }
            })
            .ok()
            .map(|handle| (sender, handle))
    });
    drop(proxy_runtime.server);
    if let Some((sender, handle)) = wake {
        let _ = sender.send(());
        let _ = handle.join();
    }
}

fn stop_server() {
    let runtime = runtime().lock().ok().and_then(|mut guard| guard.take());
    if let Some(proxy_runtime) = runtime {
        stop_proxy_runtime(proxy_runtime);
    }
    clear_proxy_session_routing();
    aggregate_scheduler::clear();
}

#[derive(Clone, Copy)]
enum RequestOrigin {
    External,
    Gui,
}

fn handle_request<R: Runtime>(app: tauri::AppHandle<R>, request: Request) {
    serve_request(app, request, RequestOrigin::External);
}

fn serve_request<R: Runtime>(app: tauri::AppHandle<R>, mut request: Request, origin: RequestOrigin) {
    let _diagnostic_scope = match diagnostic_log_path(&app) {
        Ok(path) => Some(DiagnosticScope::enter(path)),
        Err(_) => {
            eprintln!("Could not initialize proxy request diagnostics");
            None
        }
    };
    diagnostic_event(json!({
        "event": "request_started", "method": request.method().as_str(),
        "path": request_path(request.url())
    }));
    let method = request.method().clone();
    let url = request.url().to_string();
    let remote_address = request.remote_addr().map(|address| address.to_string());
    let headers = request
        .headers()
        .iter()
        .map(|header| {
            (
                header.field.as_str().as_str().to_string(),
                header.value.as_str().to_string(),
            )
        })
        .collect::<Vec<_>>();

    let is_loopback = request
        .remote_addr()
        .map(|address| address.ip().is_loopback())
        .unwrap_or(false);
    if !request_origin_allowed(origin, &url, &headers, is_loopback) {
        respond_error(request, 403, "This endpoint is not available on this connection.".into());
        return;
    }
    let quota_query = method == Method::Get && lan_keys::is_quota_endpoint(request_path(&url));
    let lan_key = match lan_keys::authorize_request(&app, &headers, is_loopback, quota_query) {
        Ok(key) => key,
        Err(error) => {
            let status = if matches!(error, lan_keys::LanKeyError::Unauthorized) {
                401
            } else {
                503
            };
            respond_error(request, status, error.to_string());
            return;
        }
    };
    if quota_query {
        if let Some(key) = lan_key.as_ref() {
            respond_payload(request, lan_keys::quota_payload(key));
        }
        return;
    }
    if method == Method::Post
        && lan_key
            .as_ref()
            .is_some_and(|key| key.remaining_usd == Some(0.0))
    {
        respond_payload(
            request,
            json_payload(
                429,
                json!({"error": {
                    "message": "This API key has reached its spending limit.",
                    "type": "insufficient_quota", "code": "quota_exceeded"
                }}),
            ),
        );
        return;
    }
    if method == Method::Post
        && lan_key
            .as_ref()
            .is_some_and(|key| key.needs_usage_review())
    {
        respond_error(
            request,
            503,
            "Unconfirmed usage has reached this API key's review limit. Ask the owner to review usage and resume access."
                .to_string(),
        );
        return;
    }
    let _lan_key_scope = lan_keys::RequestKeyScope::enter(lan_key.map(|key| key.id));

    let mut body = Vec::new();
    if let Err(error) = request.as_reader().read_to_end(&mut body) {
        respond_error(
            request,
            400,
            format!("Failed to read request body: {error}"),
        );
        return;
    }

    diagnostic_event(json!({
        "event": "request_received", "request": diagnostic_request_options(&body),
        "body": request_body_diagnostic(&body, serde_json::from_slice::<Value>(&body).ok().as_ref()),
        "headers": diagnostic_header_summary(&headers)
    }));
    let captures_conversation = tracks_proxy_session(&method, request_path(&url), &body);
    if captures_conversation {
        if let Err(error) = ensure_proxy_history(&app) {
            respond_error(request, 503, error);
            return;
        }
    }
    // Snapshot only this caller's speed; later toggles cannot change in-flight requests or retries.
    let tier = match origin {
        RequestOrigin::External => proxy_service_tier(),
        RequestOrigin::Gui => gui_runtime::service_tier(&app),
    };
    let body = snapshot_request_service_tier(
        &method,
        request_path(&url),
        body,
        Some(tier),
    );
    let session = begin_tracked_proxy_session(ProxySessionRequest {
        method: &method,
        path: request_path(&url),
        headers: &headers,
        remote_address,
        service_tier: effective_proxy_service_tier(&body, None),
        body: &body,
    });
    let result = handle_proxy_request(
        &app,
        &method,
        &url,
        &headers,
        body,
        session.as_ref().map(ProxySessionRequestGuard::session_id),
        session.as_ref().map(ProxySessionRequestGuard::request_id),
    );
    let payload = match result {
        Ok(payload) => payload,
        Err(error) => {
            diagnostic_event(json!({
                "event": "request_failed",
                "error": crate::error_logs::sanitize_diagnostic_message(&error)
            }));
            let message = upstream_error_message(&error);
            json_payload(502, json!({ "error": { "message": message } }))
        }
    };
    respond_payload(
        request,
        attach_first_response_capture(
            attach_conversation_response_capture(payload, session.as_ref()),
            session.as_ref(),
        ),
    );
}

fn request_origin_allowed(
    origin: RequestOrigin, url: &str, headers: &[(String, String)], is_loopback: bool,
) -> bool {
    let gui_path = gui_routing::upstream_path(url).is_some();
    match origin {
        RequestOrigin::External => !gui_path,
        RequestOrigin::Gui => gui_path && is_loopback
            && request_has_valid_api_key(headers, crate::codex_config::LOCAL_PROXY_TOKEN),
    }
}

fn upstream_error_message(error: &str) -> &str {
    error_messages::transport(error).unwrap_or(error)
}

fn request_has_valid_api_key(headers: &[(String, String)], expected: &str) -> bool {
    let header_key_matches = ["x-api-key", "openai-api-key", "api-key"]
        .into_iter()
        .filter_map(|name| header_value(headers, name).map(str::trim))
        .any(|actual| !actual.is_empty() && api_keys_equal(expected, actual));
    let bearer_key_matches = header_value(headers, "authorization")
        .map(str::trim)
        .and_then(|value| {
            value
                .get(..7)
                .filter(|prefix| prefix.eq_ignore_ascii_case("bearer "))
                .map(|_| value[7..].trim())
        })
        .filter(|value| !value.is_empty())
        .is_some_and(|actual| api_keys_equal(expected, actual));
    header_key_matches || bearer_key_matches
}

fn api_keys_equal(expected: &str, actual: &str) -> bool {
    let expected = expected.as_bytes();
    let actual = actual.as_bytes();
    expected.len() == actual.len()
        && expected
            .iter()
            .zip(actual)
            .fold(0_u8, |difference, (left, right)| {
                difference | (left ^ right)
            })
            == 0
}
