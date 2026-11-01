static PROXY_HISTORY: OnceLock<Arc<ProxyHistoryStore>> = OnceLock::new();
static PROXY_HISTORY_INITIALIZATION: Mutex<()> = Mutex::new(());
static PROXY_HISTORY_SAVE_FAILED: AtomicBool = AtomicBool::new(false);

fn ensure_proxy_history<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    if history_persistence::SHUTTING_DOWN.load(Ordering::Acquire) {
        return Err(history_error_message(ProxyHistoryError::Lock));
    }
    if history_persistence::WRITER.get().is_some() {
        return Ok(());
    }
    let _initialization = PROXY_HISTORY_INITIALIZATION
        .lock()
        .map_err(|_| "Conversation history is unavailable".to_string())?;
    if history_persistence::SHUTTING_DOWN.load(Ordering::Acquire) {
        return Err(history_error_message(ProxyHistoryError::Lock));
    }
    if history_persistence::WRITER.get().is_some() {
        return Ok(());
    }
    if let Some(store) = PROXY_HISTORY.get() {
        return history_persistence::start(Arc::clone(store)).map_err(history_error_message);
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "Conversation history is unavailable".to_string())?
        .join("proxy-history");
    let store = Arc::new(ProxyHistoryStore::open(&root).map_err(history_error_message)?);
    let restored = store.sessions().map_err(history_error_message)?;
    let mut sessions = proxy_sessions()
        .lock()
        .map_err(|_| history_error_message(ProxyHistoryError::Lock))?;
    for session in restored {
        sessions.entry(session.id.clone()).or_insert(session);
    }
    PROXY_HISTORY
        .set(Arc::clone(&store))
        .map_err(|_| history_error_message(ProxyHistoryError::Lock))?;
    drop(sessions);
    history_persistence::start(store).map_err(history_error_message)
}

fn history_error_message(error: ProxyHistoryError) -> String {
    // The caller records the safe message once at its response/background boundary.
    eprintln!("proxy conversation history: {error:?}");
    "Conversation history could not be saved or loaded. Check available disk space and try again."
        .to_string()
}

fn check_proxy_history_save() -> Result<(), String> {
    if PROXY_HISTORY_SAVE_FAILED.load(Ordering::Relaxed) {
        return Err("Some conversation history could not be saved. Check available disk space and restart the app."
            .to_string());
    }
    Ok(())
}

fn persist_proxy_session(session_id: &str, request_id: Option<u64>) {
    let result = history_persistence::with_writer(|writer| {
        writer
            .map(|writer| writer.enqueue(session_id, request_id))
            .transpose()
    });
    if result.is_err() {
        // Stream readers must not perform even error-log I/O. Polling surfaces this latch.
        PROXY_HISTORY_SAVE_FAILED.store(true, Ordering::Relaxed);
    }
}

fn capture_proxy_history_snapshot(
    session_id: &str,
    request_id: Option<u64>,
) -> ProxyHistoryResult<Option<ProxyHistorySnapshot>> {
    let sessions = proxy_sessions()
        .lock()
        .map_err(|_| ProxyHistoryError::Lock)?;
    Ok(sessions
        .get(session_id)
        .map(|session| ProxyHistorySnapshot {
            session: session.metadata_snapshot(),
            request: request_id
                .and_then(|id| session.requests.iter().find(|request| request.id == id))
                .cloned(),
        }))
}

impl ProxySessionState {
    fn metadata_snapshot(&self) -> Self {
        Self {
            id: self.id.clone(),
            title: self.title.clone(),
            client: self.client.clone(),
            remote_address: self.remote_address.clone(),
            connected_at: self.connected_at,
            last_seen_at: self.last_seen_at,
            active_requests: self.active_requests,
            request_count: self.request_count,
            provider: self.provider.clone(),
            concurrent_routed: self.concurrent_routed,
            account_id: self.account_id.clone(),
            account_email: self.account_email.clone(),
            model: self.model.clone(),
            context_tokens: self.context_tokens,
            gui_context: self.gui_context.clone(),
            token_totals: self.token_totals.clone(),
            requests: VecDeque::new(),
        }
    }
}

fn proxy_history_requests(session_id: &str) -> Result<Vec<ProxySessionRequestState>, String> {
    let stored = PROXY_HISTORY
        .get()
        .map(|store| store.requests(session_id))
        .transpose()
        .map_err(history_error_message)?
        .unwrap_or_default();
    let mut requests = stored
        .into_iter()
        .map(|request| (request.id, request))
        .collect::<BTreeMap<_, _>>();
    let sessions = proxy_sessions()
        .lock()
        .map_err(|_| history_error_message(ProxyHistoryError::Lock))?;
    if let Some(session) = sessions.get(session_id) {
        for request in &session.requests {
            requests.insert(request.id, request.clone());
        }
    }
    Ok(requests
        .into_values()
        .rev()
        .take(PROXY_SESSION_REQUEST_KEEP_ROWS)
        .collect())
}

fn retain_conversation_attachment(source: String) -> String {
    let id = format!("{:x}", Sha256::digest(source.as_bytes()));
    if let Some(store) = PROXY_HISTORY.get() {
        if let Err(error) = store.save_attachment(&id, &source) {
            // Invalid image bytes should only make that preview unavailable.
            if !matches!(error, ProxyHistoryError::Attachment) {
                PROXY_HISTORY_SAVE_FAILED.store(true, Ordering::Relaxed);
            }
            log_proxy_error!("{}", history_error_message(error));
        }
    }
    match conversation_attachment_cache().lock() {
        Ok(mut cache) => cache.insert(source),
        Err(_) => id,
    }
}

fn read_conversation_attachment(id: &str) -> Result<Option<String>, String> {
    if !valid_history_attachment_id(id) {
        return Err("Invalid attachment".to_string());
    }
    let source = conversation_attachment_cache()
        .lock()
        .map_err(|_| "Attachment unavailable".to_string())?
        .entries
        .iter()
        .find(|(key, _)| key == id)
        .map(|(_, source)| Arc::clone(source));
    if let Some(source) = source {
        return Ok(Some(source.to_string()));
    }
    PROXY_HISTORY
        .get()
        .map(|store| store.attachment(id))
        .transpose()
        .map(Option::flatten)
        .map_err(history_error_message)
}

fn unidentified_proxy_session_id(remote_address: Option<&str>) -> String {
    static RUN_ID: OnceLock<String> = OnceLock::new();
    let run_id = RUN_ID.get_or_init(|| uuid::Uuid::new_v4().to_string());
    // TCP source ports can be reused after a restart; they are not durable conversation IDs.
    format!("client:{run_id}:{}", remote_address.unwrap_or("local"))
}

fn remember_proxy_session_titles(titles: &HashMap<String, String>) {
    let changed = {
        let Ok(mut sessions) = proxy_sessions().lock() else {
            return;
        };
        titles
            .iter()
            .filter_map(|(id, title)| {
                let session = sessions.get_mut(id)?;
                if session.title.as_ref() == Some(title) {
                    return None;
                }
                session.title = Some(title.clone());
                Some(id.clone())
            })
            .collect::<Vec<_>>()
    };
    for id in changed {
        persist_proxy_session(&id, None);
    }
}
