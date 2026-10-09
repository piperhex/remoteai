struct HistoryTestDirectory(PathBuf);

impl HistoryTestDirectory {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!(
            "codex-switch-history-test-{}",
            uuid::Uuid::new_v4()
        )))
    }
}

impl Drop for HistoryTestDirectory {
    fn drop(&mut self) {
        // Only remove this test's uniquely named direct child of the temporary directory.
        assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
        assert!(self
            .0
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("codex-switch-history-test-"));
        if self.0.exists() {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
}

fn history_test_request(id: u64) -> ProxySessionRequestState {
    ProxySessionRequestState {
        id,
        started_at: 100,
        model: Some("image-model".to_string()),
        reasoning_effort: None,
        service_tier: Some(ProxyServiceTier::Priority),
        conversation: Some("画一个太阳".to_string()),
        response: Some("已生成 🌞".to_string()),
        input_attachments: Vec::new(),
        output_attachments: Vec::new(),
        response_truncated: false,
        interrupted: false,
        first_response_time_ms: Some(20),
        first_token_time_ms: Some(30),
        response_time_ms: Some(50),
        usage: Some(TokenUsageValues {
            total_tokens: Some(30),
            ..Default::default()
        }),
    }
}

fn history_test_snapshot(request: ProxySessionRequestState) -> ProxyHistorySnapshot {
    ProxyHistorySnapshot {
        session: ProxySessionState {
            id: "history-session".to_string(),
            title: Some("太阳".to_string()),
            client: "test".to_string(),
            remote_address: None,
            connected_at: 100,
            last_seen_at: 110,
            active_requests: 1,
            request_count: request.id,
            provider: Some("Official Codex".to_string()),
            concurrent_routed: false,
            account_id: Some("account".to_string()),
            account_email: Some("test@example.com".to_string()),
            model: Some("image-model".to_string()),
            context_tokens: Some(30),
            gui_context: None,
            token_totals: ProxySessionTokenTotals {
                total_tokens: 30,
                ..Default::default()
            },
            requests: VecDeque::new(),
        },
        request: Some(request),
    }
}

#[test]
fn gui_capacity_survives_metadata_snapshots_and_old_history_remains_readable() {
    let mut session = history_test_snapshot(history_test_request(1)).session;
    session.gui_context = Some(GuiSessionContext { capacity: Some(285_000) });
    let value = serde_json::to_value(session.metadata_snapshot()).unwrap();
    let restored: ProxySessionState = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(restored.gui_context.unwrap().capacity, Some(285_000));
    let mut old = value;
    old.as_object_mut().unwrap().remove("gui_context");
    assert!(serde_json::from_value::<ProxySessionState>(old).unwrap().gui_context.is_none());
}

#[test]
fn history_reopens_session_details_and_image_files_without_memory_cache() {
    let directory = HistoryTestDirectory::new();
    let source = "data:image/png;base64,iVBORw0KGgo=";
    let id = format!("{:x}", Sha256::digest(source.as_bytes()));
    let mut request = history_test_request(7);
    request
        .input_attachments
        .push(ProxyConversationAttachment { id: id.clone() });
    request
        .output_attachments
        .push(ProxyConversationAttachment { id: id.clone() });
    let store = ProxyHistoryStore::open(&directory.0).unwrap();
    store.save_attachment(&id, source).unwrap();
    store.save_attachment(&id, source).unwrap();
    store
        .save_with(|| Ok(Some(history_test_snapshot(request))))
        .unwrap();
    assert_eq!(
        fs::read_dir(directory.0.join("attachments"))
            .unwrap()
            .count(),
        1
    );
    drop(store);
    let reopened = ProxyHistoryStore::open(&directory.0).unwrap();
    let session = reopened.sessions().unwrap().remove(0);
    assert_eq!(session.active_requests, 0);
    assert_eq!(session.title.as_deref(), Some("太阳"));
    assert_eq!(session.request_count, 7);
    assert_eq!(session.account_email.as_deref(), Some("test@example.com"));
    assert_eq!(session.token_totals.total_tokens, 30);
    assert!(
        session.requests.is_empty(),
        "startup must not load conversation bodies"
    );
    let details = reopened.requests(&session.id).unwrap();
    assert_eq!(details[0].response.as_deref(), Some("已生成 🌞"));
    assert!(!details[0].interrupted);
    assert_eq!(details[0].first_token_time_ms, Some(30));
    assert_eq!(details[0].service_tier, Some(ProxyServiceTier::Priority));
    assert_eq!(reopened.attachment(&id).unwrap().as_deref(), Some(source));
    let next = history_test_request(session.request_count + 1);
    reopened
        .save_with(|| Ok(Some(history_test_snapshot(next))))
        .unwrap();
    assert_eq!(reopened.requests(&session.id).unwrap().len(), 2);
}

#[test]
fn history_marks_unfinished_requests_interrupted_without_inventing_a_duration() {
    let directory = HistoryTestDirectory::new();
    let store = ProxyHistoryStore::open(&directory.0).unwrap();
    let mut request = history_test_request(1);
    request.response_time_ms = None;
    request.response = Some("已收到部分回复".to_string());
    store
        .save_with(|| Ok(Some(history_test_snapshot(request))))
        .unwrap();
    drop(store);
    let reopened = ProxyHistoryStore::open(&directory.0).unwrap();
    let details = reopened.requests("history-session").unwrap();
    assert!(details[0].interrupted);
    assert!(details[0].response_time_ms.is_none());
    assert_eq!(details[0].response.as_deref(), Some("已收到部分回复"));
    assert_eq!(reopened.sessions().unwrap()[0].active_requests, 0);
}

#[test]
fn history_retains_latest_details_and_collects_only_unreferenced_images() {
    let directory = HistoryTestDirectory::new();
    let store = ProxyHistoryStore::open(&directory.0).unwrap();
    let source = "data:image/png;base64,AA==";
    let id = format!("{:x}", Sha256::digest(source.as_bytes()));
    store.save_attachment(&id, source).unwrap();
    let mut first = history_test_request(1);
    first
        .output_attachments
        .push(ProxyConversationAttachment { id: id.clone() });
    store
        .save_with(|| Ok(Some(history_test_snapshot(first))))
        .unwrap();
    for id in 2..=PROXY_SESSION_REQUEST_KEEP_ROWS as u64 + 1 {
        store
            .save_with(|| Ok(Some(history_test_snapshot(history_test_request(id)))))
            .unwrap();
    }
    assert_eq!(
        store.requests("history-session").unwrap().len(),
        PROXY_SESSION_REQUEST_KEEP_ROWS
    );
    drop(store);
    let reopened = ProxyHistoryStore::open(&directory.0).unwrap();
    assert!(reopened.attachment(&id).unwrap().is_none());
    assert!(!directory
        .0
        .join("attachments")
        .join(format!("{id}.png"))
        .exists());
    assert_eq!(
        reopened
            .requests("history-session")
            .unwrap()
            .last()
            .unwrap()
            .id,
        2
    );
}

#[test]
fn history_rejects_path_traversal_and_preserves_remote_references() {
    let directory = HistoryTestDirectory::new();
    let store = ProxyHistoryStore::open(&directory.0).unwrap();
    assert!(store.attachment("../history.sqlite3").is_err());
    assert!(store.image_path(&"a".repeat(64), "../../outside").is_err());
    assert!(store
        .save_attachment(&"a".repeat(64), "file:///private.png")
        .is_err());
    let source = "https://example.com/image.png";
    let id = format!("{:x}", Sha256::digest(source.as_bytes()));
    store.save_attachment(&id, source).unwrap();
    let mut request = history_test_request(1);
    request
        .output_attachments
        .push(ProxyConversationAttachment { id: id.clone() });
    store
        .save_with(|| Ok(Some(history_test_snapshot(request))))
        .unwrap();
    drop(store);
    let reopened = ProxyHistoryStore::open(&directory.0).unwrap();
    assert_eq!(reopened.attachment(&id).unwrap().as_deref(), Some(source));
}

#[test]
fn history_does_not_reset_an_unknown_database_version() {
    let directory = HistoryTestDirectory::new();
    fs::create_dir_all(&directory.0).unwrap();
    let connection = Connection::open(directory.0.join("history.sqlite3")).unwrap();
    connection
        .execute_batch("PRAGMA user_version=99; CREATE TABLE sentinel(value TEXT)")
        .unwrap();
    assert!(matches!(
        ProxyHistoryStore::open(&directory.0),
        Err(ProxyHistoryError::Version)
    ));
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
            .unwrap(),
        99
    );
}

#[test]
fn history_parallel_writes_capture_metadata_in_commit_order() {
    let directory = HistoryTestDirectory::new();
    let store = Arc::new(ProxyHistoryStore::open(&directory.0).unwrap());
    let counter = Arc::new(AtomicUsize::new(0));
    let workers = (0..4)
        .map(|_| {
            let store = store.clone();
            let counter = counter.clone();
            thread::spawn(move || {
                store
                    .save_with(|| {
                        let id = counter.fetch_add(1, AtomicOrdering::SeqCst) as u64 + 1;
                        Ok(Some(history_test_snapshot(history_test_request(id))))
                    })
                    .unwrap()
            })
        })
        .collect::<Vec<_>>();
    for worker in workers {
        worker.join().unwrap();
    }
    assert_eq!(store.requests("history-session").unwrap().len(), 4);
    assert_eq!(store.sessions().unwrap()[0].request_count, 4);
}

#[test]
fn history_disk_writes_do_not_hold_the_live_session_registry() {
    let directory = HistoryTestDirectory::new();
    let store = Arc::new(ProxyHistoryStore::open(&directory.0).unwrap());
    let session_id = format!("history-lock-{}", uuid::Uuid::new_v4());
    let headers = vec![("thread-id".to_string(), session_id.clone())];
    let guard = begin_proxy_session_request(&headers, None, br#"{"input":"test"}"#, None);
    let (sender, receiver) = mpsc::channel();
    let (release, waiting) = mpsc::channel();
    let writer = {
        let store = store.clone();
        let session_id = session_id.clone();
        thread::spawn(move || {
            store
                .save_with(|| {
                    let snapshot = capture_proxy_history_snapshot(&session_id, Some(1))?;
                    sender.send(()).unwrap();
                    waiting.recv_timeout(Duration::from_secs(2)).unwrap();
                    Ok(snapshot)
                })
                .unwrap()
        })
    };
    receiver.recv_timeout(Duration::from_secs(2)).unwrap();
    let memory = proxy_sessions().try_lock().is_ok();
    release.send(()).unwrap();
    writer.join().unwrap();
    drop(guard);
    proxy_sessions().lock().unwrap().remove(&session_id);
    assert!(
        memory,
        "disk waits must release the session registry used by polling"
    );
}

#[test]
fn history_failed_request_write_rolls_back_the_session_metadata() {
    let directory = HistoryTestDirectory::new();
    let store = ProxyHistoryStore::open(&directory.0).unwrap();
    store
        .save_with(|| Ok(Some(history_test_snapshot(history_test_request(1)))))
        .unwrap();
    assert!(store
        .save_with(|| Ok(Some(history_test_snapshot(history_test_request(u64::MAX)))))
        .is_err());
    assert_eq!(store.sessions().unwrap()[0].request_count, 1);
    assert_eq!(store.requests("history-session").unwrap().len(), 1);
}
