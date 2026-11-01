struct ProxySessionRequest<'a> {
    method: &'a Method,
    path: &'a str,
    headers: &'a [(String, String)],
    body: &'a [u8],
    remote_address: Option<String>,
    service_tier: Option<ProxyServiceTier>,
}

fn tracks_proxy_session(method: &Method, path: &str, body: &[u8]) -> bool {
    *method == Method::Post
        && (is_responses_endpoint(path)
            || is_image_generation_endpoint(path)
            || (is_anthropic_messages_endpoint(path) && !is_anthropic_token_probe(body)))
}

fn begin_tracked_proxy_session(
    request: ProxySessionRequest<'_>,
) -> Result<Option<ProxySessionRequestGuard>, String> {
    if !tracks_proxy_session(request.method, request.path, request.body) {
        return Ok(None);
    }
    let mut headers = std::borrow::Cow::Borrowed(request.headers);
    if is_anthropic_messages_endpoint(request.path) && proxy_session_id(request.headers).is_none() {
        headers.to_mut().push((
            "session-id".to_string(),
            anthropic_request_session_id(request.headers, request.body),
        ));
    }
    history_persistence::begin(ProxySessionRequest {
        headers: &headers,
        ..request
    })
    .map(Some)
}

const MAX_ANTHROPIC_SESSION_IDENTITY_BYTES: usize = 4_096;

fn anthropic_request_session_id(headers: &[(String, String)], body: &[u8]) -> String {
    let identity = header_value(headers, "x-session-id")
        .and_then(valid_anthropic_session_identity)
        .map(str::to_string)
        .or_else(|| anthropic_metadata_session_identity(body));
    match identity {
        // Metadata can contain account identifiers. Persist only a digest, never the raw value.
        Some(identity) => format!("anthropic:{:x}", Sha256::digest(identity.as_bytes())),
        // An SDK connection can serve unrelated conversations. Without a stable conversation
        // identifier, assign each request independently instead of pinning the whole connection.
        None => format!("anthropic:request:{}", uuid::Uuid::new_v4()),
    }
}

fn valid_anthropic_session_identity(identity: &str) -> Option<&str> {
    let identity = identity.trim();
    (!identity.is_empty()
        && identity.len() <= MAX_ANTHROPIC_SESSION_IDENTITY_BYTES
        && !identity.chars().any(char::is_control))
    .then_some(identity)
}

fn anthropic_metadata_session_identity(body: &[u8]) -> Option<String> {
    let body: Value = serde_json::from_slice(body).ok()?;
    let metadata = body.get("metadata")?;
    if let Some(session) = metadata
        .get("session_id")
        .and_then(Value::as_str)
        .and_then(valid_anthropic_session_identity)
    {
        return Some(session.to_string());
    }
    let user_id = valid_anthropic_session_identity(metadata.get("user_id")?.as_str()?)?;
    // Claude clients encode the conversation in either JSON metadata or a legacy suffix.
    // A plain API user_id identifies a user, so it must not merge that user's conversations.
    if let Ok(identity) = serde_json::from_str::<Value>(user_id) {
        let session = valid_anthropic_session_identity(identity.get("session_id")?.as_str()?)?;
        return Some(
            json!({ "session_id": session, "agent_id": identity.get("agent_id") }).to_string(),
        );
    }
    let (_, session) = user_id.rsplit_once("_session_")?;
    valid_anthropic_session_identity(session)?;
    Some(user_id.to_string())
}
