use super::*;
use serde_json::json;

fn capture_diagnostics(body: &[u8], streaming: bool) -> Value {
    let mut capture = ErrorCapture::new(streaming, 200);
    for chunk in body.chunks(3) {
        capture.observe(chunk);
    }
    capture.finish();
    capture.diagnostic_summary()
}

#[test]
fn diagnostics_preserve_protection_error_fields_without_a_failing_http_status() {
    let body = json!({"error": {
        "message": "response protection is unavailable", "type": "server_error",
        "code": "response_protection_unavailable", "param": null, "retry_after": 5,
        "request_id": "request-test", "input": "private conversation", "api_key": "fake-secret"
    }})
    .to_string();
    let summary = capture_diagnostics(body.as_bytes(), false);
    let failure = &summary["failure"];
    assert_eq!(failure["message"], "response protection is unavailable");
    assert_eq!(failure["type"], "server_error");
    assert_eq!(failure["code"], "response_protection_unavailable");
    assert_eq!(failure["retryAfter"], 5);
    assert_eq!(failure["payloadBytes"], body.len());
    assert_eq!(failure["capturedBytes"], body.len());
    assert_eq!(failure["captureTruncated"], false);
    assert_eq!(failure["jsonParsed"], true);
    assert!(failure["upstreamRequestIdHash"].is_string());
    assert!(!summary.to_string().contains("private conversation"));
    assert!(!summary.to_string().contains("fake-secret"));
    assert!(!summary.to_string().contains("request-test"));
}

#[test]
fn diagnostics_keep_stream_position_and_original_failure_messages() {
    let body = concat!(
        "data: {\"type\":\"response.created\",\"sequence_number\":0,",
        "\"response\":{\"id\":\"private-response\"}}\r\n\r\n",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"private text\"}\r\n\r\n",
        "event: response.failed\r\ndata: {\"sequence_number\":8,\"response\":{",
        "\"error\":{\"code\":\"server_error\",\"status_code\":503,",
        "\"message\":\"failed Bearer fake-credential\"},\"output\":\"private output\"}}\r\n\r\n"
    );
    let summary = capture_diagnostics(body.as_bytes(), true);
    assert_eq!(summary["eventCount"], 3);
    assert_eq!(summary["lastSequenceNumber"], 8);
    assert!(summary["responseIdHash"].is_string());
    assert_eq!(summary["recentEvents"][2]["type"], "response.failed");
    assert_eq!(summary["failure"]["statusCode"], 503);
    assert_eq!(summary["failure"]["code"], "server_error");
    assert_eq!(
        summary["failure"]["message"],
        "failed Bearer fake-credential"
    );
    for secret in ["private-response", "private text", "private output"] {
        assert!(!summary.to_string().contains(secret));
    }
}

#[test]
fn diagnostics_bound_event_history_and_count_repeated_deltas() {
    let mut capture = ErrorCapture::new(true, 200);
    for sequence in 0..30 {
        let body = format!("data: {{\"type\":\"test.{sequence}\"}}\n\n");
        capture.observe(body.as_bytes());
    }
    for _ in 0..100 {
        capture
            .observe(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"secret\"}\n\n");
    }
    let summary = capture.diagnostic_summary();
    let events = summary["recentEvents"].as_array().unwrap();
    assert_eq!(summary["eventCount"], 130);
    assert_eq!(events.len(), 12);
    assert_eq!(events.last().unwrap()["count"], 100);
    assert!(!summary.to_string().contains("secret"));
}

#[test]
fn diagnostics_report_bounded_partial_and_oversized_events() {
    let mut capture = ErrorCapture::new(true, 200);
    let mut body = b"event: error\ndata: {\"message\":\"".to_vec();
    body.extend(vec![b'x'; MAX_CAPTURE_BYTES * 2]);
    capture.observe(&body);
    let pending = capture.diagnostic_summary();
    assert_eq!(pending["pendingBytes"], body.len());
    assert_eq!(pending["pendingCaptureTruncated"], true);
    capture.finish();
    let summary = capture.diagnostic_summary();
    assert_eq!(summary["truncatedEvents"], 1);
    assert_eq!(summary["failure"]["jsonParsed"], false);
    assert_eq!(summary["failure"]["captureTruncated"], true);
    assert_eq!(summary["failure"]["capturedBytes"], MAX_CAPTURE_BYTES);
    assert_eq!(summary["failure"]["payloadBytes"], body.len());
    assert!(summary.to_string().len() < 2000);
}

#[test]
fn diagnostics_mark_truncated_messages_and_keep_incomplete_reason() {
    let body = json!({"error": {"message": "错".repeat(3000), "code": "server_error"}}).to_string();
    let summary = capture_diagnostics(body.as_bytes(), false);
    assert_eq!(summary["failure"]["fieldsTruncated"], true);
    assert_eq!(
        summary["failure"]["message"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        crate::error_logs::DIAGNOSTIC_MESSAGE_MAX_CHARS
    );
    let body = concat!(
        "data: {\"type\":\"response.incomplete\",\"response\":{",
        "\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}\n\n"
    )
    .as_bytes();
    let summary = capture_diagnostics(body, true);
    assert_eq!(summary["failure"]["incompleteReason"], "max_output_tokens");
}

#[test]
fn diagnostics_do_not_expose_successful_json_or_count_done_as_unparsed() {
    let body = br#"{"output":"private output","message":"private message"}"#;
    let summary = capture_diagnostics(body, false);
    assert!(summary["failure"].is_null());
    assert!(!summary.to_string().contains("private"));
    let summary = capture_diagnostics(b"data: [DONE]\n\n", true);
    assert_eq!(summary["unparsedEvents"], 0);
    assert!(summary["failure"].is_null());
}
