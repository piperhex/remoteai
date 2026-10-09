use super::*;
use serde_json::json;
use std::{
    io::Cursor,
    time::{Duration, Instant},
};

fn event(value: Value) -> Vec<u8> {
    format!("data: {value}\r\n\r\n").into_bytes()
}

#[test]
fn skips_metadata_heartbeats_empty_deltas_and_usage() {
    let mut detector = FirstTokenDetector::default();
    assert!(!detector.observe(b": ping\r\n\r\ndata: [DONE]\r\n\r\n"));
    for value in [
        json!({"type": "response.created"}),
        json!({"type": "response.in_progress"}),
        json!({"type": "response.output_item.added", "item": {"type": "function_call"}}),
        json!({"type": "response.output_text.delta", "delta": ""}),
        json!({"type": "response.completed", "response": {"usage": {"output_tokens": 20}}}),
        json!({"type": "error", "message": "failed"}),
        json!({"choices": [{"delta": {"role": "assistant"}}]}),
        json!({"choices": [{"delta": {"tool_calls": [{"function": {"name": "test"}}]}}]}),
    ] {
        assert!(!detector.observe(&event(value)));
    }
}

#[test]
fn recognizes_text_reasoning_and_tool_arguments_across_protocols() {
    let values = [
        json!({"type": "response.output_text.delta", "delta": "你"}),
        json!({"type": "response.reasoning_text.delta", "delta": "thinking"}),
        json!({"type": "response.reasoning_summary_text.delta", "delta": "thinking"}),
        json!({"type": "response.function_call_arguments.delta", "delta": "{"}),
        json!({"type": "response.custom_tool_call_input.delta", "delta": "command"}),
        json!({"type": "response.refusal.delta", "delta": "Sorry"}),
        json!({"choices": [{"delta": {"content": "text"}}]}),
        json!({"choices": [{"delta": {"reasoning_content": "thinking"}}]}),
        json!({"choices": [{"delta": {"tool_calls": [{"function": {"arguments": "{"}}]}}]}),
        json!({"type": "content_block_delta", "delta": {"type": "text_delta", "text": "text"}}),
        json!({"type": "content_block_delta", "delta": {"thinking": "thinking"}}),
        json!({"type": "content_block_delta", "delta": {"partial_json": "{"}}),
    ];
    for value in values {
        let bytes = event(value);
        // Every possible chunk boundary, including inside UTF-8 and CRLF.
        for split in 0..bytes.len() {
            let mut detector = FirstTokenDetector::default();
            assert!(!detector.observe(&bytes[..split]));
            assert!(detector.observe(&bytes[split..]));
            assert!(
                !detector.observe(&bytes),
                "only the first output is measured"
            );
        }
    }
}

#[test]
fn handles_multiple_events_and_limits_unterminated_events() {
    let output = event(json!({"type": "response.output_text.delta", "delta": " "}));
    let mut bytes = b"data: invalid\n\n: heartbeat\n\n".to_vec();
    bytes.extend_from_slice(&output);
    assert!(FirstTokenDetector::default().observe(&bytes));
    let mut detector = FirstTokenDetector::default();
    assert!(!detector.observe(&vec![b'x'; MAX_EVENT_BYTES + 1]));
    assert!(detector.event.is_empty());
    assert!(!detector.observe(&output));
}

#[test]
fn supports_event_name_without_payload_type_and_multiline_data() {
    let bytes = concat!(
        "event: response.output_text.delta\r\n",
        "data: {\"delta\":\r\n",
        "data: \"hello\"}\r\n\r\n"
    );
    assert!(FirstTokenDetector::default().observe(bytes.as_bytes()));
}

fn session() -> ProxySessionRequestGuard {
    let mut guard = super::super::begin_proxy_session_request(
        &[("thread-id".into(), uuid::Uuid::new_v4().to_string())],
        None,
        br#"{"model":"test","stream":true}"#,
        None,
    );
    guard.started_at = Instant::now() - Duration::from_secs(2);
    guard
}

fn payload(body: UpstreamBody) -> UpstreamPayload {
    UpstreamPayload {
        status: 200,
        content_type: Some("text/event-stream".into()),
        body,
        response_headers: vec![],
        token_usage_account: None,
        token_usage_service_tier: None,
    }
}

fn timing(guard: &ProxySessionRequestGuard) -> (Option<u64>, Option<u64>) {
    let sessions = super::super::proxy_sessions().lock().unwrap();
    let request = &sessions[guard.session_id()].requests[0];
    (request.first_response_time_ms, request.first_token_time_ms)
}

fn cleanup(guard: ProxySessionRequestGuard) {
    let id = guard.session_id.clone();
    drop(guard);
    super::super::proxy_sessions().lock().unwrap().remove(&id);
}

#[test]
fn streaming_records_first_token_independently_and_preserves_response_bytes() {
    let guard = session();
    let status = event(json!({"type": "response.created"}));
    let output = event(json!({"type": "response.output_text.delta", "delta": "hello"}));
    let bytes = [status.clone(), output.clone(), output.clone()].concat();
    let response = super::super::attach_first_response_capture(
        payload(UpstreamBody::Streaming(Box::new(Cursor::new(bytes)))),
        Some(&guard),
    );
    let UpstreamBody::Streaming(mut reader) = response.body else {
        panic!("expected stream")
    };
    assert_eq!(timing(&guard), (None, None));
    let mut buffer = vec![0; status.len()];
    reader.read_exact(&mut buffer).unwrap();
    assert_eq!(buffer, status);
    assert!(timing(&guard).0.is_some());
    assert_eq!(timing(&guard).1, None);
    buffer.resize(output.len(), 0);
    reader.read_exact(&mut buffer).unwrap();
    assert_eq!(buffer, output);
    let first = timing(&guard).1.unwrap();
    assert!(first >= 2_000);
    reader.read_exact(&mut buffer).unwrap();
    assert_eq!(timing(&guard).1, Some(first));
    cleanup(guard);
}

#[test]
fn buffered_and_failed_responses_do_not_claim_first_token_timing() {
    let guard = session();
    let output = event(json!({"type": "response.output_text.delta", "delta": "hello"}));
    let buffered = capture(
        payload(UpstreamBody::Buffered(output.clone())),
        Some(&guard),
    );
    assert!(matches!(buffered.body, UpstreamBody::Buffered(_)));
    let mut failed = payload(UpstreamBody::Streaming(Box::new(Cursor::new(output))));
    failed.status = 500;
    let UpstreamBody::Streaming(mut reader) = capture(failed, Some(&guard)).body else {
        panic!("stream")
    };
    reader.read_to_end(&mut Vec::new()).unwrap();
    assert_eq!(timing(&guard).1, None);
    cleanup(guard);
}
