#[test]
fn diagnostics_record_http_200_json_failures_and_export_the_details() {
    let directory = DiagnosticTestDirectory::new();
    let _scope = DiagnosticScope::enter(directory.log());
    let body = concat!(
        r#"{"error":{"message":"response protection is unavailable","type":"server_error","#,
        r#""code":"response_protection_unavailable","param":null}}"#
    )
    .as_bytes();
    let mut payload = diagnostic_test_payload(UpstreamBody::Streaming(Box::new(io::Cursor::new(
        body.to_vec(),
    ))));
    payload.content_type = None;
    let payload = attach_diagnostic_test_response(payload);
    let UpstreamBody::Streaming(mut reader) = payload.body else {
        panic!("expected stream")
    };
    let mut received = Vec::new();
    reader.read_to_end(&mut received).unwrap();
    assert_eq!(received, body);
    let events = directory.events();
    let failure = events
        .iter()
        .find(|entry| entry["event"] == "response_stream_error")
        .unwrap();
    assert_eq!(failure["httpStatus"], 200);
    assert_eq!(
        failure["details"]["code"],
        "response_protection_unavailable"
    );
    assert_eq!(failure["details"]["type"], "server_error");
    assert!(failure["tsMs"].is_number());
    assert_eq!(failure["schemaVersion"], 3);
    assert!(events
        .iter()
        .all(|entry| entry["requestId"] == failure["requestId"]));
    let ending = events.last().unwrap();
    assert_eq!(ending["outcome"], "upstream_error");
    assert_eq!(ending["terminalEventSeen"], false);
    assert!(ending["lastByteMs"].is_number());
    assert!(ending["idleMs"].is_number());
    let mut export = String::new();
    append_export_records(&mut export, &fs::read(directory.log()).unwrap());
    assert!(export.contains("response_protection_unavailable"));
}

#[test]
fn diagnostics_record_buffered_soft_failures_without_changing_the_response() {
    let directory = DiagnosticTestDirectory::new();
    let _scope = DiagnosticScope::enter(directory.log());
    let body = br#"{"error":{"message":"failed","code":"server_error"}}"#;
    let mut payload = diagnostic_test_payload(UpstreamBody::Buffered(body.to_vec()));
    payload.content_type = Some("application/json".into());
    let payload = attach_diagnostic_test_response(payload);
    let UpstreamBody::Buffered(received) = payload.body else {
        panic!("expected buffered response")
    };
    assert_eq!(received, body);
    let events = directory.events();
    let buffered = events.last().unwrap();
    assert_eq!(buffered["event"], "response_buffered");
    assert_eq!(buffered["upstreamErrorSeen"], true);
    assert_eq!(buffered["stream"]["failure"]["code"], "server_error");
}

#[test]
fn diagnostics_keep_unterminated_upstream_errors_when_transport_also_fails() {
    let directory = DiagnosticTestDirectory::new();
    let _scope = DiagnosticScope::enter(directory.log());
    let body =
        b"event: error\ndata: {\"error\":{\"message\":\"unavailable\",\"code\":\"server_error\"}}";
    let reader = io::Cursor::new(body.to_vec()).chain(DiagnosticBrokenReader);
    let payload = attach_diagnostic_test_response(diagnostic_test_payload(
        UpstreamBody::Streaming(Box::new(reader)),
    ));
    let UpstreamBody::Streaming(mut reader) = payload.body else {
        panic!("expected stream")
    };
    let error = reader.read_to_end(&mut Vec::new()).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::ConnectionReset);
    drop(reader);
    let events = directory.events();
    let ending = events.last().unwrap();
    assert_eq!(ending["outcome"], "read_error");
    assert_eq!(ending["stream"]["failure"]["code"], "server_error");
    assert!(events
        .iter()
        .any(|entry| entry["kind"] == "ConnectionReset"));
}

#[test]
fn diagnostics_log_original_transport_cause_chains() {
    let error = io::Error::new(
        io::ErrorKind::ConnectionReset,
        io::Error::new(io::ErrorKind::TimedOut, "Bearer fake-credential"),
    );
    let causes = diagnostic_error_causes(&error);
    assert!(!causes.is_empty());
    assert!(causes
        .iter()
        .all(|cause| cause.contains("fake-credential")));
}

#[test]
fn diagnostic_export_preserves_nested_message_values() {
    let detail = "HTTP 403 for https://example.com/releases?token=example-token; \
        path=C:\\Users\\Example\\codex.exe; Authorization: Bearer example-key";
    let entry = json!({
        "event": "request_failed", "error": detail,
        "details": { "message": detail, "causes": [{ "text": detail }] }
    });
    let mut output = String::new();
    append_export_records(&mut output, entry.to_string().as_bytes());
    assert_eq!(serde_json::from_str::<Value>(&output).unwrap(), entry);
}

#[test]
fn diagnostics_http_failures_omit_plain_bodies_and_unrelated_json_fields() {
    for body in [
        b"private conversation in a plain response".as_slice(),
        br#"{"error":{"message":"unavailable","code":"server_error","api_key":"secret"},"input":"private conversation"}"#,
    ] {
        let mut payload = diagnostic_test_payload(UpstreamBody::Buffered(body.to_vec()));
        payload.status = 503;
        payload.content_type = Some("application/json".into());
        let diagnostic = diagnostic_payload(&payload);
        assert_eq!(diagnostic["responseBody"]["bytes"], body.len());
        assert!(diagnostic["responseBody"]["stream"]["failure"].is_object());
        assert!(!diagnostic.to_string().contains("private conversation"));
        assert!(!diagnostic.to_string().contains("secret"));
    }
}

#[test]
fn diagnostics_keep_partial_position_without_treating_cancellation_as_upstream_failure() {
    let directory = DiagnosticTestDirectory::new();
    let _scope = DiagnosticScope::enter(directory.log());
    let body = b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"private text\"}";
    let payload = attach_diagnostic_test_response(diagnostic_test_payload(
        UpstreamBody::Streaming(Box::new(io::Cursor::new(body.to_vec()))),
    ));
    let UpstreamBody::Streaming(mut reader) = payload.body else {
        panic!("expected stream")
    };
    let mut received = vec![0; body.len()];
    reader.read_exact(&mut received).unwrap();
    assert_eq!(received, body);
    drop(reader);
    let events = directory.events();
    let ending = events.last().unwrap();
    assert_eq!(ending["outcome"], "dropped_before_eof");
    assert_eq!(ending["upstreamErrorSeen"], false);
    assert_eq!(ending["stream"]["pendingBytes"], body.len());
    assert!(!events
        .iter()
        .any(|entry| entry["event"] == "response_stream_error"));
    assert!(!ending.to_string().contains("private text"));
}
