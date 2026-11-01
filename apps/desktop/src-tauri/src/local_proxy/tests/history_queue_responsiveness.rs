#[test]
fn history_queue_polling_command_yields_while_first_chunk_is_forwarded_with_database_locked() {
    use std::{future::Future, task::Poll};
    let app = breakdown_responsiveness_test_app();
    ensure_proxy_history(app.handle()).unwrap();
    let store = PROXY_HISTORY.get().unwrap().clone();
    let id = uuid::Uuid::new_v4().to_string();
    let guard = begin_proxy_session_request(
        &[("thread-id".into(), id.clone())],
        None,
        br#"{"stream":true}"#,
        None,
    );
    history_persistence::WRITER
        .get()
        .unwrap()
        .flush(Duration::from_secs(5))
        .unwrap();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let blocker = thread::spawn(move || {
        let _connection = store.connection.lock().unwrap();
        ready_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(5)).is_ok()
    });
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let mut reader = history_queue_stream(&guard);
    assert!(reader.read(&mut [0; 256]).unwrap() > 0);
    let (yielded, requests) = tauri::async_runtime::block_on(async {
        let mut command = std::pin::pin!(list_proxy_session_requests(
            app.handle().clone(),
            id.clone()
        ));
        let initial =
            std::future::poll_fn(|context| Poll::Ready(command.as_mut().poll(context))).await;
        // Independent executor work runs before releasing SQLite, as a UI event would.
        release_tx.send(()).unwrap();
        let yielded = initial.is_pending();
        let result = match initial {
            Poll::Pending => command.await,
            Poll::Ready(result) => result,
        };
        (yielded, result.unwrap())
    });
    assert!(
        blocker.join().unwrap(),
        "executor must progress before the lock timeout"
    );
    assert!(
        yielded,
        "polling must yield instead of blocking the executor thread"
    );
    assert!(requests[0].first_token_time_ms.is_some());
    drop(reader);
    drop(guard);
    history_persistence::WRITER
        .get()
        .unwrap()
        .flush(Duration::from_secs(5))
        .unwrap();
    proxy_sessions().lock().unwrap().remove(&id);
}
