#[test]
fn active_quota_switch_keeps_session_request_polling_responsive() {
    for status in [401, 403, 429] {
        assert_active_account_switch_keeps_polling_responsive(status);
    }
}

fn assert_active_account_switch_keeps_polling_responsive(status: u16) {
    let session_id = format!("quota-switch-{}", uuid::Uuid::new_v4());
    let headers = vec![("thread-id".to_string(), session_id.clone())];
    let guard = begin_proxy_session_request(&headers, None, br#"{"input":"hello"}"#, None);
    let (switch_started, switch_started_receiver) = mpsc::channel();
    let (finish_switch, finish_switch_receiver) = mpsc::channel();
    let request = thread::spawn(move || {
        let coordinator = AutoSwitchCoordinator::default();
        let mut requests = 0;
        retry_upstream_request_with(
            Duration::from_secs(1),
            || {
                requests += 1;
                Ok(official_payload(if requests == 1 { status } else { 200 }, 0))
            },
            |_, event| {
                assert!(matches!(event, UpstreamQuotaEvent::Retry { .. }));
                coordinator
                    .switch_or_wait(0, 0, "current", || {
                        switch_started.send(()).unwrap();
                        finish_switch_receiver
                            .recv_timeout(Duration::from_secs(5))
                            .unwrap();
                        Ok(AutoSwitchAttempt::Switched)
                    })
                    .unwrap()
            },
            |_| panic!("quota switch must precede backoff"),
        )
        .unwrap()
        .status
    });
    switch_started_receiver
        .recv_timeout(Duration::from_secs(5))
        .unwrap();

    for _ in 0..3 {
        assert!(active_proxy_session_ids().unwrap().contains(&session_id));
        let requests = list_proxy_session_requests_blocking(&session_id).unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].response_time_ms.is_none());
    }
    finish_switch.send(()).unwrap();
    assert_eq!(request.join().unwrap(), 200);
    drop(guard);
    proxy_sessions().lock().unwrap().remove(&session_id);
}
