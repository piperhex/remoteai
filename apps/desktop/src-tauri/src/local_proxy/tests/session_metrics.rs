use super::*;
use serde_json::json;

fn request(output_tokens: Option<u64>, response_time_ms: Option<u64>) -> ProxySessionRequestState {
    serde_json::from_value(json!({
        "id": 1, "started_at": 1,
        "input_attachments": [], "output_attachments": [], "response_truncated": false,
        "first_response_time_ms": 1_000, "response_time_ms": response_time_ms,
        "usage": { "output_tokens": output_tokens }
    }))
    .unwrap()
}

fn session(last_seen_at: u64, requests: Vec<ProxySessionRequestState>) -> ProxySessionState {
    let mut session: ProxySessionState = serde_json::from_value(json!({
        "id": last_seen_at.to_string(), "client": "test", "connected_at": 1,
        "last_seen_at": last_seen_at, "request_count": requests.len(), "concurrent_routed": false,
        "token_totals": {
            "total_tokens": 0, "input_tokens": 0, "output_tokens": 0,
            "reasoning_tokens": 0, "cached_tokens": 0
        }
    }))
    .unwrap();
    session.requests = requests.into();
    session
}

#[test]
fn tps_uses_combined_output_time_without_first_response_wait() {
    let sessions = [session(
        1,
        vec![
            request(Some(100), Some(2_000)),
            request(Some(300), Some(4_000)),
        ],
    )];
    let summary = summarize_recent_sessions(sessions.iter());
    assert_eq!(summary.total_first_response_time_ms, 2_000);
    assert_eq!(summary.request_count, 2);
    assert_eq!(summary.total_output_tokens, 400);
    assert_eq!(summary.total_output_time_ms, 4_000);
    assert_eq!(summary.output_request_count, 2);
}

#[test]
fn ttft_averages_observed_tokens_including_active_requests_without_using_first_bytes() {
    let historical = request(Some(100), Some(2_000));
    assert_eq!(
        historical.first_token_time_ms, None,
        "old history stays compatible"
    );
    let mut active = request(None, None);
    active.first_token_time_ms = Some(2_500);
    let mut completed = request(Some(100), Some(5_000));
    completed.first_token_time_ms = Some(3_500);
    let mut zero = request(None, None);
    zero.first_token_time_ms = Some(0);
    let sessions = [session(1, vec![historical, active, completed, zero])];
    let summary = summarize_recent_sessions(sessions.iter());
    assert_eq!(summary.total_first_token_time_ms, 6_000);
    assert_eq!(summary.first_token_request_count, 3);
    assert_eq!(summary.total_first_response_time_ms, 4_000);
}

#[test]
fn tps_skips_incomplete_interrupted_and_invalid_timings_without_changing_latency() {
    let mut interrupted = request(Some(100), Some(2_000));
    interrupted.interrupted = true;
    let mut no_first_response = request(Some(100), Some(2_000));
    no_first_response.first_response_time_ms = None;
    let sessions = [session(
        1,
        vec![
            request(Some(100), None),
            request(None, Some(2_000)),
            request(Some(100), Some(1_000)),
            request(Some(100), Some(500)),
            interrupted,
            no_first_response,
        ],
    )];
    let summary = summarize_recent_sessions(sessions.iter());
    assert_eq!(summary.request_count, 5);
    assert_eq!(summary.total_first_response_time_ms, 5_000);
    assert_eq!(summary.total_output_tokens, 0);
    assert_eq!(summary.total_output_time_ms, 0);
    assert_eq!(summary.output_request_count, 0);
}

#[test]
fn tps_keeps_known_zero_output_and_only_the_five_most_recent_sessions() {
    let sessions = [6, 1, 4, 3, 5, 2].map(|last_seen| {
        let tokens = if last_seen == 1 { 100_000 } else { 0 };
        session(last_seen, vec![request(Some(tokens), Some(2_000))])
    });
    let summary = summarize_recent_sessions(sessions.iter());
    assert_eq!(summary.request_count, 5);
    assert_eq!(summary.total_output_tokens, 0);
    assert_eq!(summary.total_output_time_ms, 5_000);
    assert_eq!(summary.output_request_count, 5);
    assert_eq!(
        summarize_recent_sessions(std::iter::empty()),
        ProxySessionLatencySummary::default()
    );
}

#[test]
fn metrics_command_yields_while_active_requests_hold_the_registry_lock() {
    use std::{future::Future, sync::mpsc, task::Poll, thread, time::Duration};

    let (locked_sender, locked_receiver) = mpsc::channel();
    let (release_sender, release_receiver) = mpsc::channel();
    let worker = thread::spawn(move || {
        let guard = super::super::proxy_sessions().lock().unwrap();
        locked_sender.send(()).unwrap();
        let released = release_receiver
            .recv_timeout(Duration::from_secs(5))
            .is_ok();
        drop(guard);
        released
    });
    locked_receiver
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    let yielded = tauri::async_runtime::block_on(async {
        let mut command = std::pin::pin!(futures_util::future::try_join(
            super::super::get_recent_proxy_session_latency(),
            get_proxy_session_metrics("responsive-conversation".into()),
        ));
        let first_poll = std::future::poll_fn(|cx| Poll::Ready(command.as_mut().poll(cx))).await;
        release_sender.send(()).unwrap();
        let yielded = first_poll.is_pending();
        match first_poll {
            Poll::Pending => command.await.unwrap(),
            Poll::Ready(result) => result.unwrap(),
        };
        yielded
    });
    assert!(
        worker.join().unwrap(),
        "independent work must release the lock without timing out"
    );
    assert!(
        yielded,
        "polling must not block the async executor on the session lock"
    );
}

#[test]
fn conversation_metrics_are_isolated_even_when_other_conversations_are_more_recent() {
    let id = uuid::Uuid::new_v4().to_string();
    let other_id = uuid::Uuid::new_v4().to_string();
    let mut selected = session(1, vec![request(Some(200), Some(3_000))]);
    selected.requests[0].first_token_time_ms = Some(1_500);
    selected.id = id.clone();
    let mut other = session(10, vec![request(Some(90_000), Some(2_000))]);
    other.requests[0].first_token_time_ms = Some(50);
    other.id = other_id.clone();
    {
        let mut sessions = super::super::proxy_sessions().lock().unwrap();
        sessions.insert(id.clone(), selected);
        sessions.insert(other_id.clone(), other);
    }
    let summary = tauri::async_runtime::block_on(get_proxy_session_metrics(id.clone())).unwrap();
    let unknown = read_session_metrics(&uuid::Uuid::new_v4().to_string()).unwrap();
    {
        let mut sessions = super::super::proxy_sessions().lock().unwrap();
        sessions.remove(&id);
        sessions.remove(&other_id);
    }
    assert_eq!(summary.total_output_tokens, 200);
    assert_eq!(summary.total_first_token_time_ms, 1_500);
    assert_eq!(summary.first_token_request_count, 1);
    assert_eq!(summary.total_output_time_ms, 2_000);
    assert_eq!(summary.output_request_count, 1);
    assert_eq!(unknown, ProxySessionLatencySummary::default());
}

#[test]
fn conversation_metrics_reject_invalid_identifiers() {
    for id in [
        "".to_owned(),
        " ".into(),
        "thread\nother".into(),
        "x".repeat(MAX_THREAD_ID_BYTES + 1),
    ] {
        assert!(tauri::async_runtime::block_on(get_proxy_session_metrics(id)).is_err());
    }
}
