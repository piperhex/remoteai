#[test]
fn history_queue_concurrent_streams_keep_final_history_when_database_and_queue_are_full() {
    let fixture = HistoryQueueFixture::new();
    let blocker = fixture.lock_database();
    let ids = (0..16)
        .map(|_| uuid::Uuid::new_v4().to_string())
        .collect::<Vec<_>>();
    let maximum_delivery = std::sync::atomic::AtomicU64::new(0);
    let accepted = std::sync::atomic::AtomicUsize::new(0);
    let rejected = std::sync::atomic::AtomicUsize::new(0);
    thread::scope(|scope| {
        for id in &ids {
            let writer = fixture.writer.clone();
            let maximum_delivery = &maximum_delivery;
            let accepted = &accepted;
            let rejected = &rejected;
            scope.spawn(move || {
                history_persistence::TEST_WRITER
                    .with(|current| *current.borrow_mut() = Some(writer));
                for _ in 0..40 {
                    let Ok(_lease) =
                        history_persistence::with_writer(|writer| writer.unwrap().enter())
                    else {
                        rejected.fetch_add(1, Ordering::Relaxed);
                        continue;
                    };
                    accepted.fetch_add(1, Ordering::Relaxed);
                    let headers = [("thread-id".into(), id.clone())];
                    let guard = history_persistence::begin(ProxySessionRequest {
                        method: &Method::Post,
                        path: "/v1/responses",
                        headers: &headers,
                        body: br#"{"stream":true}"#,
                        remote_address: None,
                        service_tier: None,
                    })
                    .unwrap();
                    let mut reader = history_queue_stream(&guard);
                    let started = Instant::now();
                    let mut bytes = [0; 256];
                    assert!(reader.read(&mut bytes).unwrap() > 0);
                    maximum_delivery
                        .fetch_max(started.elapsed().as_micros() as u64, Ordering::Relaxed);
                    reader.read_to_end(&mut Vec::new()).unwrap();
                }
            });
        }
    });
    assert!(fixture.writer.close(Duration::from_millis(20)).is_err());
    let max_us = maximum_delivery.load(Ordering::Relaxed);
    assert!(max_us < 150_000, "max delivery: {max_us} us");
    blocker.execute_batch("COMMIT").unwrap();
    fixture.writer.flush(Duration::from_secs(20)).unwrap();
    {
        let _lease = fixture.writer.enter().unwrap();
        let guard = fixture.begin().unwrap();
        history_queue_stream(&guard)
            .read_to_end(&mut Vec::new())
            .unwrap();
    }
    fixture.writer.close(Duration::from_secs(20)).unwrap();
    let reopened = ProxyHistoryStore::open(&fixture.directory.0).unwrap();
    assert!(reopened.requests(&fixture.id).unwrap()[0]
        .response_time_ms
        .is_some());
    let mut saved_count = 0;
    for id in &ids {
        let saved = reopened.requests(id).unwrap();
        saved_count += saved.len();
        for (index, request) in saved.iter().enumerate() {
            assert_eq!(request.id, saved.len() as u64 - index as u64);
            assert_eq!(request.response.as_deref(), Some("hello"));
            assert!(request.first_token_time_ms.is_some() && request.response_time_ms.is_some());
            assert!(!request.interrupted);
        }
        proxy_sessions().lock().unwrap().remove(id);
    }
    let accepted = accepted.load(Ordering::Relaxed);
    let rejected = rejected.load(Ordering::Relaxed);
    assert_eq!(accepted + rejected, 640);
    assert_eq!(
        saved_count, accepted,
        "every admitted request must reach disk"
    );
    assert!(rejected > 0, "slow storage must backpressure admission");
    assert!(
        accepted <= 512,
        "pending work plus already active producers must stay bounded"
    );
    eprintln!(
        "history_stress={}",
        json!({"attempted": 640, "accepted": accepted,
        "rejected": rejected, "producers": 16, "max_delivery_us": max_us})
    );
}

#[test]
fn history_queue_first_chunk_does_not_wait_for_the_store_mutex() {
    let fixture = HistoryQueueFixture::new();
    let connection = fixture.store.connection.lock().unwrap();
    let guard = fixture.begin().unwrap();
    let mut reader = history_queue_stream(&guard);
    let started = Instant::now();
    let mut bytes = [0; 256];
    assert!(reader.read(&mut bytes).unwrap() > 0);
    assert!(started.elapsed() < Duration::from_millis(150));
    drop(connection);
    reader.read_to_end(&mut Vec::new()).unwrap();
    drop(reader);
    drop(guard);
    fixture.writer.close(Duration::from_secs(5)).unwrap();
    assert!(fixture.store.requests(&fixture.id).unwrap()[0]
        .first_token_time_ms
        .is_some());
}
