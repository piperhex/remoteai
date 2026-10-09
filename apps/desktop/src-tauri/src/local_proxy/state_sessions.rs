fn runtime() -> &'static Mutex<Option<ProxyRuntime>> {
    RUNTIME.get_or_init(|| Mutex::new(None))
}

fn token_usage_db_lock() -> &'static Mutex<()> {
    TOKEN_USAGE_DB_LOCK.get_or_init(|| Mutex::new(()))
}

struct LockedTokenUsageConnection {
    _guard: MutexGuard<'static, ()>,
    connection: Connection,
}

impl Deref for LockedTokenUsageConnection {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        &self.connection
    }
}

fn proxy_sessions() -> &'static Mutex<HashMap<String, ProxySessionState>> {
    PROXY_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

static PROXY_SESSION_UNLIMITED_CONVERSATION: OnceLock<AtomicBool> = OnceLock::new();

fn proxy_session_unlimited_conversation() -> &'static AtomicBool {
    PROXY_SESSION_UNLIMITED_CONVERSATION.get_or_init(|| AtomicBool::new(false))
}

pub(crate) fn active_proxy_session_ids() -> Result<HashSet<String>, String> {
    let sessions = proxy_sessions()
        .lock()
        .map_err(|_| "Proxy session registry lock is poisoned".to_string())?;
    Ok(sessions
        .values()
        .filter(|session| session.active_requests > 0)
        .map(|session| session.id.clone())
        .collect())
}

fn concurrent_account_router() -> &'static Mutex<ConcurrentAccountRouter> {
    CONCURRENT_ACCOUNT_ROUTER.get_or_init(|| Mutex::new(ConcurrentAccountRouter::default()))
}

fn auto_switch_coordinator() -> &'static AutoSwitchCoordinator {
    AUTO_SWITCH_COORDINATOR.get_or_init(AutoSwitchCoordinator::default)
}

fn proxy_session_id(headers: &[(String, String)]) -> Option<String> {
    for name in ["thread-id", "session-id", "session_id"] {
        if let Some(value) = header_value(headers, name)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(value.to_string());
        }
    }

    header_value(headers, "x-codex-window-id")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|window_id| {
            window_id
                .rsplit_once(':')
                .filter(|(_, generation)| generation.parse::<u64>().is_ok())
                .map(|(thread_id, _)| thread_id)
                .unwrap_or(window_id)
                .to_string()
        })
}

fn begin_proxy_session_request(
    headers: &[(String, String)],
    remote_address: Option<String>,
    body: &[u8],
    service_tier: Option<ProxyServiceTier>,
) -> ProxySessionRequestGuard {
    let id = proxy_session_id(headers)
        .unwrap_or_else(|| unidentified_proxy_session_id(remote_address.as_deref()));
    let client = header_value(headers, "user-agent")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Codex client")
        .to_string();
    let now = unix_now();
    let (model, reasoning_effort) = proxy_request_metadata(body);
    let conversation = capture_session_request_conversation(body, headers);
    let started_at = Instant::now();
    let mut request_id = 1;
    if let Ok(mut sessions) = proxy_sessions().lock() {
        let session = sessions
            .entry(id.clone())
            .or_insert_with(|| ProxySessionState {
                id: id.clone(),
                title: session_titles::from_request(headers).map(str::to_owned),
                client: client.clone(),
                remote_address: remote_address.clone(),
                connected_at: now,
                last_seen_at: now,
                active_requests: 0,
                request_count: 0,
                provider: None,
                concurrent_routed: false,
                account_id: None,
                account_email: None,
                model: None,
                context_tokens: None,
                gui_context: None,
                token_totals: ProxySessionTokenTotals::default(),
                requests: VecDeque::new(),
            });
        session.client = client;
        if remote_address.is_some() {
            session.remote_address = remote_address;
        }
        session.last_seen_at = now;
        session.active_requests = session.active_requests.saturating_add(1);
        session.request_count = session.request_count.saturating_add(1);
        request_id = session.request_count;
        session.requests.push_back(ProxySessionRequestState {
            id: request_id,
            started_at: now,
            model,
            reasoning_effort,
            service_tier,
            conversation: conversation.text,
            input_attachments: conversation.attachments,
            response: None,
            output_attachments: Vec::new(),
            response_truncated: false,
            interrupted: false,
            first_response_time_ms: None,
            first_token_time_ms: None,
            response_time_ms: None,
            usage: None,
        });
        while session.requests.len() > PROXY_SESSION_REQUEST_KEEP_ROWS {
            session.requests.pop_front();
        }
    }
    persist_proxy_session(&id, Some(request_id));
    ProxySessionRequestGuard {
        expects_event_stream: serde_json::from_slice::<Value>(body)
            .ok()
            .and_then(|value| value.get("stream").and_then(Value::as_bool))
            .unwrap_or(false),
        session_id: id,
        request_id,
        started_at,
    }
}

const MAX_PROXY_SESSION_CONVERSATION_CHARS: usize = 12_000;

#[cfg(test)]
fn proxy_request_conversation(body: &[u8]) -> Option<String> {
    capture_request_conversation(body).text
}

fn proxy_request_metadata(body: &[u8]) -> (Option<String>, Option<String>) {
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return (None, None);
    };
    let model = requested_model(&value).map(ToString::to_string);
    let reasoning_effort = value
        .pointer("/reasoning/effort")
        .or_else(|| value.get("reasoning_effort"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|effort| !effort.is_empty())
        .map(ToString::to_string);
    (model, reasoning_effort)
}

fn update_proxy_session_target(
    session_id: Option<&str>,
    request_id: Option<u64>,
    provider: &str,
    model: &str,
) {
    let Some(session_id) = session_id else {
        return;
    };
    if let Ok(mut sessions) = proxy_sessions().lock() {
        if let Some(session) = sessions.get_mut(session_id) {
            session.provider = Some(provider.to_string());
            session.model = Some(model.to_string());
            if let Some(request) = request_id.and_then(|request_id| {
                session
                    .requests
                    .iter_mut()
                    .find(|request| request.id == request_id)
            }) {
                request.model = Some(model.to_string());
            }
            session.last_seen_at = unix_now();
        }
    }
    persist_proxy_session(session_id, request_id);
}

fn update_proxy_session_usage(
    session_id: Option<&str>,
    account_id: Option<&str>,
    account_email: Option<&str>,
    usage: Option<&TokenUsageValues>,
) {
    let Some(session_id) = session_id else {
        return;
    };
    if let Ok(mut sessions) = proxy_sessions().lock() {
        if let Some(session) = sessions.get_mut(session_id) {
            if let Some(account_id) = account_id {
                session.account_id = Some(account_id.to_string());
            }
            if let Some(account_email) = account_email {
                session.account_email = Some(account_email.to_string());
            }
            if let Some(usage) = usage {
                if let Some(context_tokens) = token_usage_total(usage) {
                    session.context_tokens = Some(context_tokens);
                }
                session.token_totals.add_usage(usage);
            }
            session.last_seen_at = unix_now();
        }
    }
    persist_proxy_session(session_id, None);
}

fn mark_proxy_session_concurrent_account(
    session_id: Option<&str>,
    account_id: &str,
    account_email: &str,
) {
    let Some(session_id) = session_id else {
        return;
    };
    if let Ok(mut sessions) = proxy_sessions().lock() {
        if let Some(session) = sessions.get_mut(session_id) {
            session.concurrent_routed = true;
            session.account_id = Some(account_id.to_string());
            session.account_email = Some(account_email.to_string());
        }
    }
    persist_proxy_session(session_id, None);
}

fn should_mark_proxy_session_concurrent_account(
    state: &ManagerStateFile,
    concurrent_account_id: Option<&str>,
    account_id_override: Option<&str>,
) -> bool {
    state.concurrent_account_routing_enabled
        && (concurrent_account_id.is_some() || account_id_override.is_some())
}

fn update_proxy_session_request_usage(
    session_id: Option<&str>,
    request_id: Option<u64>,
    usage: &TokenUsageValues,
) {
    let (Some(session_id), Some(request_id)) = (session_id, request_id) else {
        return;
    };
    if let Ok(mut sessions) = proxy_sessions().lock() {
        if let Some(request) = sessions.get_mut(session_id).and_then(|session| {
            session
                .requests
                .iter_mut()
                .find(|request| request.id == request_id)
        }) {
            request.usage = Some(usage.clone());
        }
    }
    persist_proxy_session(session_id, Some(request_id));
}

fn record_proxy_session_first_response(
    session_id: &str,
    request_id: u64,
    first_response_time_ms: u64,
) {
    if let Ok(mut sessions) = proxy_sessions().lock() {
        if let Some(request) = sessions.get_mut(session_id).and_then(|session| {
            session
                .requests
                .iter_mut()
                .find(|request| request.id == request_id)
        }) {
            request
                .first_response_time_ms
                .get_or_insert(first_response_time_ms);
        }
    }
    persist_proxy_session(session_id, Some(request_id));
}

fn finish_proxy_session_request(session_id: &str, request_id: u64, response_time_ms: u64) {
    if let Ok(mut sessions) = proxy_sessions().lock() {
        if let Some(session) = sessions.get_mut(session_id) {
            session.active_requests = session.active_requests.saturating_sub(1);
            if let Some(request) = session
                .requests
                .iter_mut()
                .find(|request| request.id == request_id)
            {
                request.response_time_ms = Some(response_time_ms);
            }
            session.last_seen_at = unix_now();
        }
    }
    persist_proxy_session(session_id, Some(request_id));
}

fn clear_proxy_session_routing() {
    if let Ok(mut router) = concurrent_account_router().lock() {
        router.clear();
    }
}
