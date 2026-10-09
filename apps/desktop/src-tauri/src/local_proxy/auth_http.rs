fn persist_or_reload_managed_auth(
    paths: &Paths,
    account_id: &str,
    expected: &Value,
    auth: &mut Value,
) -> Result<bool, String> {
    if write_managed_auth_if_unchanged(paths, account_id, expected, auth)? {
        return Ok(true);
    }
    *auth = read_json(&managed_auth_path(paths, account_id))?;
    validate_auth(auth)?;
    Ok(false)
}

fn refresh_or_reload_managed_auth(
    client: &Client,
    paths: &Paths,
    account_id: &str,
    auth: &mut Value,
) -> Result<(), String> {
    let expected = auth.clone();
    let current = read_json(&managed_auth_path(paths, account_id))?;
    if current != expected {
        *auth = current;
        validate_auth(auth)?;
        return Ok(());
    }
    if let Err(error) = refresh_tokens(client, auth) {
        let current = read_json(&managed_auth_path(paths, account_id))?;
        if current == expected {
            return Err(error);
        }
        *auth = current;
        validate_auth(auth)?;
        return Ok(());
    }
    persist_or_reload_managed_auth(paths, account_id, &expected, auth)?;
    Ok(())
}

fn invalid_agent_identity_task_response(
    authentication: &OfficialRequestAuthentication,
    payload: &UpstreamPayload,
) -> bool {
    let OfficialRequestAuthentication::AgentIdentity { .. } = authentication else {
        return false;
    };
    let UpstreamBody::Buffered(body) = &payload.body else {
        return false;
    };
    reqwest::StatusCode::from_u16(payload.status)
        .ok()
        .is_some_and(|status| {
            agent_identity::is_invalid_task_response(status, &String::from_utf8_lossy(body))
        })
}

fn refresh_agent_identity_task<R: Runtime>(
    authentication: &mut OfficialRequestAuthentication,
    app: &tauri::AppHandle<R>,
    client: &Client,
) -> Result<(), String> {
    let OfficialRequestAuthentication::AgentIdentity {
        active_account_id,
        auth,
        request_authentication,
    } = authentication
    else {
        return Ok(());
    };
    let expected = auth.clone();
    agent_identity::register_task(client, auth)?;
    persist_or_reload_managed_auth(&resolve_paths(app)?, active_account_id, &expected, auth)?;
    *request_authentication = agent_identity::request_authentication(auth)?;
    Ok(())
}

fn apply_forward_headers(
    mut request: reqwest::blocking::RequestBuilder,
    headers: &[(String, String)],
    skip_auth: bool,
) -> reqwest::blocking::RequestBuilder {
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if should_skip_header(&lower, skip_auth) {
            continue;
        }
        request = request.header(name.as_str(), value.as_str());
    }
    request
}

fn should_skip_header(name: &str, skip_auth: bool) -> bool {
    matches!(
        name,
        "host"
            | "content-length"
            | "connection"
            | "transfer-encoding"
            | "accept-encoding"
            | "proxy-connection"
            | "x-forwarded-for"
            | "x-forwarded-host"
            | "x-forwarded-proto"
            | ANTHROPIC_BRIDGE_HEADER
            | LOCAL_PROXY_ACTOR_AUTHORIZATION_HEADER
            | crate::codex_config::LOCAL_PROXY_REQUEST_PURPOSE_HEADER
    ) || (skip_auth
        && matches!(
            name,
            "authorization"
                | "x-api-key"
                | "openai-api-key"
                | "api-key"
                | "chatgpt-account-id"
                | "cookie"
                | "proxy-authorization"
                | "originator"
        ))
}

fn http_client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .timeout(UPSTREAM_RESPONSE_IDLE_TIMEOUT)
        .connect_timeout(UPSTREAM_CONNECT_TIMEOUT)
        .build()
        .map_err(|error| format!("Failed to create proxy HTTP client: {error}"))
}

// Once any request body has been handed to the transport, a timeout is ambiguous:
// the upstream may already be working. Only retry timeouts before that point.
fn send_with_timeout_retries(
    mut build_request: impl FnMut() -> RequestBuilder,
    failure_context: &str,
) -> Result<ReqwestResponse, String> {
    let request = upstream_transport::Request::prepare(build_request())
        .map_err(|error| format!("{failure_context}: {error}"))?;
    let mut attempt = 0;
    let result = retry_timeout_operation(
        || {
            attempt += 1;
            let result = request.send();
            diagnostic_http_result(&result, attempt);
            if result
                .as_ref()
                .is_err_and(upstream_transport::Error::can_retry)
                && attempt < UPSTREAM_TIMEOUT_ATTEMPT_LIMIT
            {
                diagnostic_retry("transport_timeout", Duration::ZERO);
                crate::error_logs::record_proxy_error(
                    &format!("{failure_context}: request timed out; retrying."),
                    None,
                );
            }
            result
        },
        upstream_transport::Error::can_retry,
    );
    match result {
        Ok(response) => Ok(response),
        Err(error) => Err(transport_error_detail(&error, failure_context, attempt)),
    }
}

fn transport_error_detail(
    error: &upstream_transport::Error,
    failure_context: &str,
    attempts: usize,
) -> String {
    // Display alone hides nested DNS/TLS/socket failures. Keep the sanitized cause chain
    // until the response boundary so GUI and shared requests can explain the actual failure.
    let mut details = vec![crate::error_logs::sanitize_diagnostic_message(
        &error.to_string(),
    )];
    for cause in diagnostic_error_causes(error) {
        if !details.contains(&cause) {
            details.push(cause);
        }
    }
    format!(
        "{failure_context}: {} (attempts: {attempts})",
        details.join(": ")
    )
}

fn retry_timeout_operation<T, E>(
    mut operation: impl FnMut() -> Result<T, E>,
    is_timeout: impl Fn(&E) -> bool,
) -> Result<T, E> {
    for attempt in 1..=UPSTREAM_TIMEOUT_ATTEMPT_LIMIT {
        match operation() {
            Err(error) if is_timeout(&error) && attempt < UPSTREAM_TIMEOUT_ATTEMPT_LIMIT => {
                continue
            }
            result => return result,
        }
    }
    unreachable!("the retry loop always returns on its final attempt")
}

fn reqwest_method(method: &Method) -> Result<reqwest::Method, String> {
    reqwest::Method::from_bytes(method.as_str().as_bytes())
        .map_err(|error| format!("Unsupported HTTP method {}: {error}", method.as_str()))
}

fn stream_response(response: ReqwestResponse) -> Result<UpstreamPayload, String> {
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let response_headers = forwarded_response_headers(response.headers());
    if !status_ok(status) {
        let body = response
            .bytes()
            .map_err(|error| format!("Failed to read upstream error response: {error}"))?;
        return Ok(UpstreamPayload {
            status,
            content_type,
            response_headers,
            body: UpstreamBody::Buffered(body.to_vec()),
            token_usage_service_tier: None,
            token_usage_account: None,
        });
    }
    Ok(UpstreamPayload {
        status,
        content_type,
        response_headers,
        body: UpstreamBody::Streaming(Box::new(response)),
        token_usage_service_tier: None,
        token_usage_account: None,
    })
}

fn forwarded_response_headers(headers: &reqwest::header::HeaderMap) -> Vec<(String, String)> {
    [
        "etag",
        "x-models-etag",
        CODEX_RATE_LIMIT_REACHED_TYPE_HEADER,
    ]
    .into_iter()
    .filter_map(|name| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(|value| (name.to_string(), value.to_string()))
    })
    .collect()
}

fn build_upstream_url(base_url: &str, endpoint: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let endpoint = endpoint.trim_start_matches('/');
    let has_versioned_path = base_url_ends_with_version_segment(base);
    let endpoint = if has_versioned_path {
        endpoint.strip_prefix("v1/").unwrap_or(endpoint)
    } else {
        endpoint
    };

    let origin_only = base
        .split_once("://")
        .map(|(_, rest)| !rest.contains('/'))
        .unwrap_or_else(|| !base.contains('/'));
    let mut url = if has_versioned_path {
        format!("{base}/{endpoint}")
    } else if origin_only {
        format!("{base}/v1/{endpoint}")
    } else {
        format!("{base}/{endpoint}")
    };
    while url.contains("/v1/v1") {
        url = url.replace("/v1/v1", "/v1");
    }
    url
}

fn base_url_ends_with_version_segment(base_url: &str) -> bool {
    let Some(version) = base_url.rsplit('/').next() else {
        return false;
    };
    let Some(version_number) = version.strip_prefix('v') else {
        return false;
    };
    !version_number.is_empty()
        && version_number
            .chars()
            .all(|character| character.is_ascii_digit())
}

fn official_url(endpoint: &str) -> String {
    let endpoint = endpoint.trim_start_matches('/');
    let endpoint = endpoint.strip_prefix("v1/").unwrap_or(endpoint);
    format!("{}/{}", OFFICIAL_CODEX_BASE_URL, endpoint)
}

fn request_path(url: &str) -> &str {
    let url = gui_routing::upstream_path(url).unwrap_or(url);
    url.split_once('?').map_or(url, |(path, _)| path)
}

fn upstream_endpoint_for_codex_request(url: &str) -> String {
    let path = request_path(url);
    let normalized_path = normalized_responses_endpoint(path).unwrap_or(path);
    match url.split_once('?') {
        Some((_, query)) if !query.is_empty() => format!("{normalized_path}?{query}"),
        _ => normalized_path.to_string(),
    }
}

fn is_responses_endpoint(path: &str) -> bool {
    normalized_responses_endpoint(path).is_some()
}

fn is_response_create_endpoint(path: &str) -> bool {
    normalized_responses_endpoint(path) == Some("/v1/responses")
}

fn normalized_responses_endpoint(path: &str) -> Option<&'static str> {
    match path {
        "/responses" | "/v1/responses" | "/v1/v1/responses" | "/codex/v1/responses" => {
            Some("/v1/responses")
        }
        "/responses/compact"
        | "/v1/responses/compact"
        | "/v1/v1/responses/compact"
        | "/codex/v1/responses/compact" => Some("/v1/responses/compact"),
        _ => None,
    }
}

fn is_image_generation_endpoint(path: &str) -> bool {
    matches!(
        path,
        "/images/generations"
            | "/v1/images/generations"
            | "/v1/v1/images/generations"
            | "/codex/v1/images/generations"
            | "/images/edits"
            | "/v1/images/edits"
            | "/v1/v1/images/edits"
            | "/codex/v1/images/edits"
    )
}

fn status_ok(status: u16) -> bool {
    (200..300).contains(&status)
}

fn is_event_stream(content_type: Option<&str>) -> bool {
    content_type
        .map(|value| value.to_ascii_lowercase().contains("text/event-stream"))
        .unwrap_or(false)
}

fn json_payload(status: u16, value: Value) -> UpstreamPayload {
    UpstreamPayload {
        status,
        content_type: Some("application/json; charset=utf-8".to_string()),
        response_headers: Vec::new(),
        body: UpstreamBody::Buffered(serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec())),
        token_usage_service_tier: None,
        token_usage_account: None,
    }
}

fn attach_first_response_capture(
    mut payload: UpstreamPayload,
    session: Option<&ProxySessionRequestGuard>,
) -> UpstreamPayload {
    let Some(context) = session.map(ProxySessionRequestGuard::first_response_context) else {
        return payload;
    };
    payload.body = match payload.body {
        UpstreamBody::Buffered(body) => {
            context.record();
            UpstreamBody::Buffered(body)
        }
        UpstreamBody::Streaming(inner) => {
            UpstreamBody::Streaming(Box::new(FirstResponseCaptureReader {
                inner,
                context: Some(context),
            }))
        }
    };
    first_token::capture(payload, session)
}

fn respond_payload(request: Request, payload: UpstreamPayload) {
    let payload = restore_stream_content_type(&request, payload);
    let payload = attach_proxy_error_capture(attach_diagnostic_response(payload));
    let UpstreamPayload {
        status,
        content_type,
        response_headers,
        body,
        ..
    } = payload;
    match body {
        UpstreamBody::Buffered(body) => {
            let mut response = Response::from_data(body).with_status_code(StatusCode(status));
            add_content_type(&mut response, content_type.as_deref());
            add_forwarded_response_headers(&mut response, &response_headers);
            if let Err(error) = request.respond(response) {
                diagnostic_event(
                    json!({ "event": "response_delivery_failed", "kind": format!("{:?}", error.kind()) }),
                );
                log_proxy_error!("Failed to send proxy response: {error}");
            }
        }
        UpstreamBody::Streaming(reader) => {
            let mut response = Response::new(StatusCode(status), Vec::new(), reader, None, None);
            add_content_type(&mut response, content_type.as_deref());
            add_forwarded_response_headers(&mut response, &response_headers);
            let result = if is_event_stream(content_type.as_deref()) {
                sse_transport::respond(request, response)
            } else {
                request.respond(response)
            };
            if let Err(error) = result {
                diagnostic_event(
                    json!({ "event": "response_delivery_failed", "kind": format!("{:?}", error.kind()) }),
                );
                log_proxy_error!("Failed to send proxy response: {error}");
            }
        }
    }
}

fn restore_stream_content_type(request: &Request, mut payload: UpstreamPayload) -> UpstreamPayload {
    if payload.content_type.is_some()
        || !status_ok(payload.status)
        || !matches!(payload.body, UpstreamBody::Streaming(_))
    {
        return payload;
    }
    let accepts_sse = request.headers().iter().any(|header| {
        header.field.equiv("Accept")
            && header
                .value
                .as_str()
                .split(',')
                .any(|value| value.trim().eq_ignore_ascii_case("text/event-stream"))
    });
    if accepts_sse {
        // Some upstreams omit Content-Type. The client's explicit SSE request still needs
        // immediate flushes and a terminated response on read failure, not a five-minute idle wait.
        payload.content_type = Some("text/event-stream".to_owned());
    }
    payload
}

fn add_content_type<R: Read>(response: &mut Response<R>, content_type: Option<&str>) {
    if let Some(content_type) = content_type {
        if let Ok(header) = Header::from_bytes("Content-Type", content_type.as_bytes()) {
            response.add_header(header);
        }
    }
}

fn add_forwarded_response_headers<R: Read>(
    response: &mut Response<R>,
    headers: &[(String, String)],
) {
    for (name, value) in headers {
        if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
        }
    }
}

fn respond_error(request: Request, status: u16, message: String) {
    respond_payload(
        request,
        json_payload(status, json!({ "error": { "message": message } })),
    );
}
