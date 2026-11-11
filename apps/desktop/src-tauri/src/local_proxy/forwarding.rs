struct OfficialForwardRequest<'a, R: Runtime> {
    app: &'a tauri::AppHandle<R>,
    method: &'a Method,
    url: &'a str,
    headers: &'a [(String, String)],
    body: Vec<u8>,
    model: &'a str,
    session_id: Option<&'a str>,
    account_id_override: Option<&'a str>,
}

fn forward_official<R: Runtime>(
    request: OfficialForwardRequest<'_, R>,
) -> Result<UpstreamPayload, String> {
    if *request.method == Method::Get
        && matches!(request_path(request.url), "/models" | "/v1/models")
    {
        return official_model_cache::with_fallback(request.app, || forward_official_upstream(request));
    }
    forward_official_upstream(request)
}

fn forward_official_upstream<R: Runtime>(
    request: OfficialForwardRequest<'_, R>,
) -> Result<UpstreamPayload, String> {
    let OfficialForwardRequest {
        app,
        method,
        url,
        headers,
        body,
        model,
        session_id,
        account_id_override,
    } = request;
    let client = http_client()?;
    let upstream_endpoint = upstream_endpoint_for_codex_request(url);
    let credential_purpose = official_credential_purpose(request_path(&upstream_endpoint), &body);
    let mut credentials = match official_credentials(
        app,
        &client,
        OfficialCredentialOptions {
            purpose: credential_purpose,
            session_id,
            account_id_override,
        },
    ) {
        Ok(credentials) => credentials,
        Err(error) => return error.into_response(),
    };
    diagnostic_event(json!({
        "event": "official_credentials_ready",
        "account": diagnostic_account(&credentials.token_usage_account)
    }));
    let upstream_url = official_url(&upstream_endpoint);
    let body = official_body_for_upstream(method, &upstream_endpoint, body, model);
    let mut payload = send_official_request(
        &client,
        method,
        &upstream_url,
        headers,
        body.as_slice(),
        &credentials.authentication,
    )?;
    if invalid_agent_identity_task_response(&credentials.authentication, &payload) {
        diagnostic_retry("agent_identity_task_refresh", Duration::ZERO);
        record_retried_proxy_response(&payload);
        // Recalculate discovery's remaining credential budget before another network operation.
        refresh_agent_identity_task(&mut credentials.authentication, app, &http_client()?)?;
        payload = send_official_request(
            &client,
            method,
            &upstream_url,
            headers,
            body.as_slice(),
            &credentials.authentication,
        )?;
    }
    payload.token_usage_account = Some(credentials.token_usage_account);
    Ok(payload)
}

fn send_official_request(
    client: &Client,
    method: &Method,
    upstream_url: &str,
    headers: &[(String, String)],
    body: &[u8],
    authentication: &OfficialRequestAuthentication,
) -> Result<UpstreamPayload, String> {
    let body = responses_lite::prepare(method, upstream_url, headers, body.to_vec())
        .map_err(|error| error.wire())?;
    diagnostic_event(json!({
        "event": "official_request_prepared", "request": diagnostic_request_options(&body),
        "responsesLite": responses_lite::enabled(headers)
    }));
    let request_method = reqwest_method(method)?;
    let response = send_with_timeout_retries(
        || {
            let mut request = client
                .request(request_method.clone(), upstream_url)
                .header("originator", ORIGINATOR)
                .header("User-Agent", "codex_cli_rs/0.1.0");
            match authentication {
                OfficialRequestAuthentication::OAuth {
                    access_token,
                    chatgpt_account_id,
                } => {
                    request = request.bearer_auth(access_token);
                    if let Some(account_id) = chatgpt_account_id {
                        request = request.header("ChatGPT-Account-Id", account_id);
                    }
                }
                OfficialRequestAuthentication::AgentIdentity {
                    request_authentication,
                    ..
                } => {
                    request = request
                        .header("Authorization", &request_authentication.authorization)
                        .header("ChatGPT-Account-Id", &request_authentication.account_id);
                    if request_authentication.is_fedramp {
                        request = request.header("x-openai-fedramp", "true");
                    }
                }
            }
            let request = apply_forward_headers(request, headers, true);
            official_model_request::apply_user_agent(request, method, upstream_url, headers)
                .body(body.to_vec())
        },
        "Official Codex proxy request failed",
    )?;
    let mut payload = quota_sse::inspect_initial_official_sse(stream_response(response)?)?;
    payload.token_usage_service_tier = forwarded_request_service_tier(&body, headers);
    Ok(payload)
}

fn official_body_for_upstream(method: &Method, url: &str, body: Vec<u8>, model: &str) -> Vec<u8> {
    official_body_for_upstream_with_tier(method, url, body, model, None)
}

fn official_body_for_upstream_with_tier(
    method: &Method,
    url: &str,
    body: Vec<u8>,
    model: &str,
    service_tier: Option<ProxyServiceTier>,
) -> Vec<u8> {
    if *method != Method::Post || !is_responses_endpoint(request_path(url)) {
        return body;
    }
    let model = model.trim();
    if model.is_empty() {
        return body;
    }
    let Ok(mut value) = serde_json::from_slice::<Value>(&body) else {
        return body;
    };
    let removed_incompatible_reasoning =
        remove_incompatible_official_reasoning_from_input(&mut value);
    let removed_incompatible_message_ids = official_input::remove_incompatible_message_ids(&mut value);
    let removed_unsupported_controls = remove_unsupported_official_generation_controls(&mut value);
    if requested_model(&value).is_some()
        && !removed_incompatible_reasoning
        && !removed_incompatible_message_ids
        && !removed_unsupported_controls
        && service_tier.is_none()
    {
        return body;
    }
    if requested_model(&value).is_none() {
        value["model"] = Value::String(selected_official_model(&value, model));
    }
    apply_proxy_service_tier(&mut value, service_tier);
    serde_json::to_vec(&value).unwrap_or(body)
}

fn remove_unsupported_official_generation_controls(value: &mut Value) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    // The Codex account endpoint rejects sampling and output limits sent by other CLIs.
    // Keep this at the official transport boundary so third-party APIs retain their options.
    let mut changed = false;
    for field in ["max_output_tokens", "temperature", "top_p"] {
        changed |= object.remove(field).is_some();
    }
    changed
}

fn apply_proxy_service_tier(value: &mut Value, tier: Option<ProxyServiceTier>) {
    let Some(tier) = tier else {
        return;
    };
    if value.is_object() {
        value["service_tier"] = Value::String(tier.as_str().to_string());
    }
}

fn forward_provider(
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    let client = http_client()?;
    let upstream_endpoint = upstream_endpoint_for_codex_request(url);
    let upstream_url = provider_request_options::url(provider, &upstream_endpoint);
    let body = enforce_provider_service_tier(body, headers, provider);
    let body = provider_body_for_upstream(method, &upstream_endpoint, body, provider);
    let body = apply_provider_body_options(method, &body, provider)?;
    diagnostic_event(json!({
        "event": "provider_request_prepared", "request": diagnostic_request_options(&body),
        "responsesLite": responses_lite::enabled(headers)
    }));
    let request_method = reqwest_method(method)?;
    let response = send_with_timeout_retries(
        || {
            let request = client.request(request_method.clone(), &upstream_url);
            let request = if provider.api_key.trim().is_empty() {
                request
            } else {
                request.bearer_auth(provider.api_key.trim())
            };
            provider_request_options::headers(apply_forward_headers(request, headers, true), provider)
                .body(body.clone())
        },
        "Provider proxy request failed",
    )?;
    let mut payload = stream_response(response)?;
    payload.token_usage_service_tier = forwarded_request_service_tier(&body, headers);
    if *method == Method::Get && matches!(request_path(&upstream_endpoint), "/models" | "/v1/models") {
        return responses_lite::provider_catalog(payload);
    }
    Ok(payload)
}

fn forward_provider_request(
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    if provider_request_options::uses_full_url(provider)
        && (*method != Method::Post || !is_response_create_endpoint(request_path(url)))
    {
        return Err("This endpoint only supports new responses".to_string());
    }
    // Validate before automatic API fallback so malformed Lite requests are never replayed as Chat.
    let body = responses_lite::prepare(method, url, headers, body)
        .map_err(|error| error.wire())?;
    if provider.kind == ProviderKind::Custom
        && *method == Method::Post
        && is_response_create_endpoint(request_path(url))
    {
        return forward_provider_with_api_fallback(method, url, headers, body, provider);
    }
    let request = serde_json::from_slice::<Value>(&body).unwrap_or(Value::Null);
    let format = provider
        .model_api_formats
        .get(&selected_provider_model(&request, provider))
        .copied()
        .unwrap_or(provider.api_format);
    if is_responses_endpoint(request_path(url))
        && matches!(format, ProviderApiFormat::AnthropicMessages | ProviderApiFormat::GeminiGenerateContent)
    {
        return Err("This provider does not support this response operation".to_string());
    }
    if is_responses_endpoint(request_path(url))
        && format == ProviderApiFormat::OpenaiChat
    {
        return forward_chat_bridge(method, url, headers, body, provider);
    }
    forward_provider(method, url, headers, body, provider)
}

fn forward_provider_with_api_fallback(
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    forward_provider_api(provider, &body, |format| {
        forward_provider_with_format(format, method, url, headers, body.clone(), provider)
    })
}

fn forward_provider_with_format(
    format: ProviderApiFormat,
    method: &Method,
    url: &str,
    headers: &[(String, String)],
    body: Vec<u8>,
    provider: &ProviderProfile,
) -> Result<UpstreamPayload, String> {
    match format {
        ProviderApiFormat::OpenaiResponses => {
            forward_provider(method, url, headers, body, provider)
        }
        ProviderApiFormat::OpenaiChat => forward_chat_bridge(method, url, headers, body, provider),
        ProviderApiFormat::AnthropicMessages => anthropic_upstream::forward(method, headers, body, provider),
        ProviderApiFormat::GeminiGenerateContent => gemini_upstream::forward(method, headers, body, provider),
    }
}

fn apply_provider_body_options(
    method: &Method,
    body: &[u8],
    provider: &ProviderProfile,
) -> Result<Vec<u8>, String> {
    if *method != Method::Post || provider.request_options.as_ref().is_none_or(|options| options.body.is_empty()) {
        return Ok(body.to_vec());
    }
    let mut value = serde_json::from_slice(body).map_err(|error|
        request_error::RequestError::json(request_error::Stage::Request, &error).wire())?;
    provider_request_options::body(&mut value, provider);
    serde_json::to_vec(&value).map_err(|_| request_error::RequestError::new(
        request_error::Stage::Request, request_error::Problem::Encode).wire())
}
