struct HistoryQueueFixture {
    store: Arc<ProxyHistoryStore>,
    writer: Arc<history_writer::Writer>,
    directory: HistoryTestDirectory,
    id: String,
}

impl HistoryQueueFixture {
    fn new() -> Self {
        let directory = HistoryTestDirectory::new();
        let store = Arc::new(ProxyHistoryStore::open(&directory.0).unwrap());
        let background = store.clone();
        let writer = Arc::new(
            history_writer::Writer::start(
                move |work| history_persistence::save(&background, work),
                |error| eprintln!("controlled history error: {error:?}"),
            )
            .unwrap(),
        );
        history_persistence::TEST_WRITER
            .with(|current| *current.borrow_mut() = Some(writer.clone()));
        Self {
            directory,
            store,
            writer,
            id: uuid::Uuid::new_v4().to_string(),
        }
    }

    fn begin(&self) -> Result<ProxySessionRequestGuard, String> {
        let headers = [("thread-id".into(), self.id.clone())];
        history_persistence::begin(ProxySessionRequest {
            method: &Method::Post,
            path: "/v1/responses",
            headers: &headers,
            body: br#"{"stream":true,"model":"controlled"}"#,
            remote_address: None,
            service_tier: None,
        })
    }

    fn lock_database(&self) -> Connection {
        let connection = Connection::open(self.directory.0.join("history.sqlite3")).unwrap();
        connection.execute_batch("BEGIN IMMEDIATE").unwrap();
        connection
    }
}

impl Drop for HistoryQueueFixture {
    fn drop(&mut self) {
        self.writer.close(Duration::from_secs(20)).unwrap();
        history_persistence::TEST_WRITER.with(|current| *current.borrow_mut() = None);
        proxy_sessions().lock().unwrap().remove(&self.id);
    }
}

fn history_queue_stream(guard: &ProxySessionRequestGuard) -> Box<dyn Read + Send> {
    let bytes = b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n";
    let payload = UpstreamPayload {
        status: 200,
        content_type: Some("text/event-stream".into()),
        body: UpstreamBody::Streaming(Box::new(std::io::Cursor::new(bytes.to_vec()))),
        response_headers: vec![],
        token_usage_account: None,
        token_usage_service_tier: None,
    };
    let payload = attach_first_response_capture(
        attach_conversation_response_capture(payload, Some(guard)),
        Some(guard),
    );
    let UpstreamBody::Streaming(reader) = payload.body else {
        panic!("stream expected")
    };
    reader
}

#[test]
fn history_queue_first_chunk_and_durability_are_measured_separately_under_sqlite_lock() {
    let mut measurements = Vec::new();
    for full in [false, true] {
        for sample in 0..5 {
            let fixture = HistoryQueueFixture::new();
            let guard = fixture.begin().unwrap();
            fixture.writer.flush(Duration::from_secs(5)).unwrap();
            let blocker = fixture.lock_database();
            let release = thread::spawn(move || {
                thread::sleep(Duration::from_millis(250));
                blocker.execute_batch("COMMIT").unwrap();
            });
            let started = Instant::now();
            // Reproduce the old read->save_with->return ordering using the same store.
            fixture
                .store
                .save_with(|| capture_proxy_history_snapshot(&fixture.id, Some(1)))
                .unwrap();
            let baseline = started.elapsed();
            release.join().unwrap();
            let blocker = fixture.lock_database();
            let release = thread::spawn(move || {
                thread::sleep(Duration::from_millis(250));
                blocker.execute_batch("COMMIT").unwrap();
            });
            fixture.writer.enqueue(&fixture.id, Some(1)).unwrap();
            if full {
                for id in 0..1_024 {
                    fixture.writer.enqueue("overflow", Some(id)).unwrap();
                }
            }
            let mut reader = history_queue_stream(&guard);
            let started = Instant::now();
            let mut bytes = [0; 256];
            assert!(reader.read(&mut bytes).unwrap() > 0);
            let delivery = started.elapsed();
            assert!(
                proxy_sessions().try_lock().is_ok(),
                "polling registry remains available"
            );
            reader.read_to_end(&mut Vec::new()).unwrap();
            drop(reader);
            drop(guard);
            fixture.writer.flush(Duration::from_secs(10)).unwrap();
            let durable = started.elapsed();
            release.join().unwrap();
            let saved = fixture.store.requests(&fixture.id).unwrap().remove(0);
            assert_eq!(saved.response.as_deref(), Some("hello"));
            assert!(saved.first_response_time_ms.is_some() && saved.first_token_time_ms.is_some());
            assert!(saved.response_time_ms.is_some());
            assert!(baseline >= Duration::from_millis(200));
            assert!(
                delivery < Duration::from_millis(150),
                "delivery: {delivery:?}"
            );
            assert!(durable >= Duration::from_millis(200));
            measurements.push(json!({"full": full, "sample": sample,
                "baseline_delivery_ms": baseline.as_secs_f64() * 1000.0,
                "queued_delivery_ms": delivery.as_secs_f64() * 1000.0,
                "queued_durable_ms": durable.as_secs_f64() * 1000.0}));
        }
    }
    eprintln!("history_latency={}", json!(measurements));
    if let Some(path) = std::env::var_os("PROXY_HISTORY_BENCH_OUTPUT") {
        fs::write(path, serde_json::to_vec_pretty(&measurements).unwrap()).unwrap();
    }
}

#[test]
fn history_queue_retention_never_evicts_unpersisted_or_live_requests() {
    let fixture = HistoryQueueFixture::new();
    fixture
        .store
        .connection
        .lock()
        .unwrap()
        .execute_batch(
            "CREATE TABLE written_ids(id INTEGER PRIMARY KEY);
         CREATE TRIGGER audit_history AFTER INSERT ON requests BEGIN
         INSERT OR IGNORE INTO written_ids VALUES(new.request_id); END;",
        )
        .unwrap();
    let blocker = fixture.lock_database();
    for _ in 0..PROXY_SESSION_REQUEST_KEEP_ROWS {
        drop(fixture.begin().unwrap());
    }
    assert!(
        fixture.begin().is_err(),
        "full retention must reject before evicting dirty state"
    );
    assert_eq!(
        proxy_sessions().lock().unwrap()[&fixture.id]
            .requests
            .front()
            .unwrap()
            .id,
        1
    );
    blocker.execute_batch("COMMIT").unwrap();
    fixture.writer.flush(Duration::from_secs(20)).unwrap();
    for _ in 0..100 {
        drop(fixture.begin().unwrap());
    }
    fixture.writer.flush(Duration::from_secs(20)).unwrap();
    let written: usize = fixture
        .store
        .connection
        .lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM written_ids", [], |row| row.get(0))
        .unwrap();
    assert_eq!(written, PROXY_SESSION_REQUEST_KEEP_ROWS + 100);
    let saved = fixture.store.requests(&fixture.id).unwrap();
    assert_eq!(saved.len(), PROXY_SESSION_REQUEST_KEEP_ROWS);
    assert_eq!(saved.first().unwrap().id, 600);
    assert_eq!(saved.last().unwrap().id, 101);
    assert!(saved
        .iter()
        .all(|request| request.response_time_ms.is_some()));
    // A still-live oldest request cannot be removed even after a successful disk flush.
    proxy_sessions()
        .lock()
        .unwrap()
        .get_mut(&fixture.id)
        .unwrap()
        .requests
        .front_mut()
        .unwrap()
        .response_time_ms = None;
    assert!(fixture.begin().is_err());
}

#[test]
fn history_queue_delayed_first_token_cannot_revert_final_state_or_resurrect_removed_session() {
    let fixture = HistoryQueueFixture::new();
    let guard = fixture.begin().unwrap();
    let mut reader = history_queue_stream(&guard);
    reader.read_to_end(&mut Vec::new()).unwrap();
    drop(reader);
    update_proxy_session_request_usage(
        Some(&fixture.id),
        Some(1),
        &TokenUsageValues {
            total_tokens: Some(42),
            ..Default::default()
        },
    );
    drop(guard);
    fixture.writer.flush(Duration::from_secs(5)).unwrap();
    fixture.writer.enqueue(&fixture.id, Some(1)).unwrap();
    fixture.writer.flush(Duration::from_secs(5)).unwrap();
    let saved = fixture.store.requests(&fixture.id).unwrap().remove(0);
    assert!(saved.response_time_ms.is_some());
    assert_eq!(saved.usage.unwrap().total_tokens, Some(42));
    assert_eq!(saved.response.as_deref(), Some("hello"));
    // There is no production clear-history API. Simulate an atomic clear under
    // the same store serialization guard, with an already queued invalidation.
    let connection = fixture.store.connection.lock().unwrap();
    fixture.writer.enqueue(&fixture.id, Some(1)).unwrap();
    proxy_sessions().lock().unwrap().remove(&fixture.id);
    connection
        .execute("DELETE FROM sessions WHERE id=?1", params![fixture.id])
        .unwrap();
    drop(connection);
    fixture.writer.flush(Duration::from_secs(5)).unwrap();
    assert!(fixture.store.requests(&fixture.id).unwrap().is_empty());
}
