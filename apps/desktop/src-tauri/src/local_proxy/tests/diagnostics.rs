struct DiagnosticTestDirectory(PathBuf);

fn attach_diagnostic_test_response(payload: UpstreamPayload) -> UpstreamPayload {
    attach_diagnostic_response(payload, "/v1/responses")
}

impl DiagnosticTestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("proxy-diagnostics-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn log(&self) -> PathBuf {
        self.0.join(DIAGNOSTIC_LOG_FILE_NAME)
    }

    fn events(&self) -> Vec<Value> {
        fs::read_to_string(self.log())
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}

impl Drop for DiagnosticTestDirectory {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn diagnostic_test_payload(body: UpstreamBody) -> UpstreamPayload {
    UpstreamPayload {
        status: 200,
        content_type: Some("text/event-stream".to_string()),
        response_headers: Vec::new(),
        body,
        token_usage_account: None,
        token_usage_service_tier: None,
    }
}

#[test]
fn diagnostics_capture_stream_completion_without_conversation_text() {
    let directory = DiagnosticTestDirectory::new();
    let scope = DiagnosticScope::enter(directory.log());
    let body = concat!(
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"private conversation\"}\n\n",
        "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_test\"}}\n\n"
    )
    .as_bytes();
    let payload = attach_diagnostic_test_response(diagnostic_test_payload(
        UpstreamBody::Streaming(Box::new(io::Cursor::new(body.to_vec()))),
    ));
    let UpstreamBody::Streaming(mut reader) = payload.body else {
        panic!("expected stream")
    };
    let mut output = Vec::new();
    reader.read_to_end(&mut output).unwrap();
    assert_eq!(output, body);
    drop(reader);
    drop(scope);
    let events = directory.events();
    let endings: Vec<_> = events
        .iter()
        .filter(|entry| entry["event"] == "response_stream_finished")
        .collect();
    assert_eq!(endings.len(), 1);
    assert_eq!(endings[0]["outcome"], "eof");
    assert_eq!(endings[0]["terminalEventSeen"], true);
    assert!(endings[0]["firstByteMs"].is_number());
    assert!(events
        .iter()
        .all(|entry| entry["requestId"] == events[0]["requestId"]));
    assert!(!fs::read_to_string(directory.log())
        .unwrap()
        .contains("private conversation"));
}

#[test]
fn diagnostics_distinguish_truncated_streams_and_consumer_drop() {
    let directory = DiagnosticTestDirectory::new();
    let _scope = DiagnosticScope::enter(directory.log());
    for consume in [true, false] {
        let payload = attach_diagnostic_test_response(diagnostic_test_payload(
            UpstreamBody::Streaming(Box::new(io::Cursor::new(
                b"data: {\"type\":\"response.created\"}\n\n".to_vec(),
            ))),
        ));
        let UpstreamBody::Streaming(mut reader) = payload.body else {
            panic!("expected stream")
        };
        if consume {
            reader.read_to_end(&mut Vec::new()).unwrap();
        }
    }
    let events = directory.events();
    let outcomes: Vec<_> = events
        .iter()
        .filter(|entry| entry["event"] == "response_stream_finished")
        .map(|entry| entry["outcome"].as_str().unwrap())
        .collect();
    assert_eq!(outcomes, ["upstream_error", "dropped_before_eof"]);
}

#[test]
fn diagnostics_account_and_upstream_headers_exclude_secrets() {
    let account = TokenUsageAccount {
        account_id: "private-account".into(),
        account_email: "private@example.com".into(),
        active_account_generation: 1,
        auto_switch_attempt_generation: 2,
        auto_switch_eligible: true,
        concurrent_request_started_at: Some(Instant::now()),
    };
    let value = diagnostic_account(&account);
    assert_eq!(value["concurrentAssignment"], true);
    assert!(!value.to_string().contains("private"));
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("x-request-id", "upstream-trace".parse().unwrap());
    headers.insert("retry-after", "30".parse().unwrap());
    headers.insert("content-type", "application/json".parse().unwrap());
    headers.insert("content-length", "143".parse().unwrap());
    headers.insert("openai-processing-ms", "120".parse().unwrap());
    headers.insert("authorization", "Bearer secret".parse().unwrap());
    headers.insert("set-cookie", "secret-cookie".parse().unwrap());
    let summary = diagnostic_upstream_headers(&headers);
    assert_eq!(summary["x-request-id"], "upstream-trace");
    assert_eq!(summary["retry-after"], "30");
    assert_eq!(summary["content-type"], "application/json");
    assert_eq!(summary["content-length"], "143");
    assert_eq!(summary["openai-processing-ms"], "120");
    assert!(!summary.to_string().contains("secret"));
}

#[test]
fn diagnostics_record_every_rate_limit_attempt_and_retry() {
    let directory = DiagnosticTestDirectory::new();
    let _scope = DiagnosticScope::enter(directory.log());
    let mut attempts = 0;
    let result = retry_upstream_request_with(
        Duration::from_secs(30),
        || {
            attempts += 1;
            let mut payload = diagnostic_test_payload(UpstreamBody::Buffered(Vec::new()));
            payload.status = if attempts == 1 { 429 } else { 200 };
            Ok(payload)
        },
        |_, _| false,
        |_| Duration::from_secs(1),
    )
    .unwrap();
    assert_eq!(result.status, 200);
    let events = directory.events();
    let results: Vec<_> = events
        .iter()
        .filter(|entry| entry["event"] == "upstream_attempt")
        .map(|entry| entry["result"]["status"].as_u64().unwrap())
        .collect();
    assert_eq!(results, [429, 200]);
    assert!(events.iter().any(|entry| entry["reason"] == "rate_limit"));
}

#[test]
fn diagnostics_rotate_at_ten_mib_and_snapshot_both_files() {
    assert_eq!(DIAGNOSTIC_LOG_MAX_BYTES, 10 * 1024 * 1024);
    let directory = DiagnosticTestDirectory::new();
    let path = directory.log();
    let file = fs::File::create(&path).unwrap();
    file.set_len(DIAGNOSTIC_LOG_MAX_BYTES).unwrap();
    drop(file);
    rotate_diagnostic_log_if_needed(&path).unwrap();
    assert!(!path.with_extension("jsonl.old").exists());
    append_diagnostic_entry(&path, &json!({ "event": "boundary" })).unwrap();
    append_diagnostic_entry(&path, &json!({ "event": "new" })).unwrap();
    assert!(path.with_extension("jsonl.old").exists());
    let snapshots = diagnostic_snapshot(&path).unwrap();
    assert_eq!(snapshots.len(), 2);
    assert!(String::from_utf8_lossy(&snapshots[0]).contains("boundary"));
    assert!(String::from_utf8_lossy(&snapshots[1]).contains("new"));
}

#[test]
fn diagnostics_snapshot_is_consistent_during_parallel_requests() {
    let directory = DiagnosticTestDirectory::new();
    let path = directory.log();
    let handles: Vec<_> = (0..4)
        .map(|worker| {
            let path = path.clone();
            thread::spawn(move || {
                let _scope = DiagnosticScope::enter(path);
                for number in 0..25 {
                    diagnostic_event(
                        json!({ "event": "parallel", "worker": worker, "number": number }),
                    );
                }
            })
        })
        .collect();
    for _ in 0..10 {
        for snapshot in diagnostic_snapshot(&path).unwrap() {
            for line in snapshot
                .split(|byte| *byte == b'\n')
                .filter(|line| !line.is_empty())
            {
                serde_json::from_slice::<Value>(line).unwrap();
            }
        }
    }
    for handle in handles {
        handle.join().unwrap();
    }
    assert_eq!(directory.events().len(), 104);
}

#[test]
fn diagnostics_export_protects_app_data_and_reports_broken_records() {
    let directory = DiagnosticTestDirectory::new();
    let app_data = directory.0.join("app");
    fs::create_dir(&app_data).unwrap();
    assert!(validate_diagnostic_destination(&app_data.join("state.json"), &app_data).is_err());
    assert!(validate_diagnostic_destination(&directory.0.join("export.jsonl"), &app_data).is_ok());
    let mut output = String::new();
    append_export_records(
        &mut output,
        b"{\"event\":\"old\",\"result\":{\"error\":\"Bearer secret-token\"}}\ninvalid\n",
    );
    assert!(output.contains("Bearer secret-token"));
    assert!(output.contains("unreadable_diagnostic_record"));
    for line in output.lines() {
        serde_json::from_str::<Value>(line).unwrap();
    }
}

struct DiagnosticWaitingReader(std::sync::mpsc::Receiver<Vec<u8>>);

impl Read for DiagnosticWaitingReader {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        let bytes = self.0.recv().unwrap_or_default();
        assert!(bytes.len() <= target.len());
        target[..bytes.len()].copy_from_slice(&bytes);
        Ok(bytes.len())
    }
}

#[test]
fn diagnostics_export_and_session_poll_remain_available_during_active_stream() {
    let directory = DiagnosticTestDirectory::new();
    let path = directory.log();
    let (sender, receiver) = std::sync::mpsc::channel();
    let (ready, started) = std::sync::mpsc::channel();
    let worker_path = path.clone();
    let stream = thread::spawn(move || {
        let _scope = DiagnosticScope::enter(worker_path);
        let payload = attach_diagnostic_test_response(diagnostic_test_payload(
            UpstreamBody::Streaming(Box::new(DiagnosticWaitingReader(receiver))),
        ));
        ready.send(()).unwrap();
        let UpstreamBody::Streaming(mut reader) = payload.body else {
            panic!("expected stream")
        };
        reader.read_to_end(&mut Vec::new()).unwrap();
    });
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    let (done, completed) = std::sync::mpsc::channel();
    let exporter = thread::spawn(move || {
        let snapshot = diagnostic_snapshot(&path).unwrap();
        get_recent_proxy_session_latency_blocking().unwrap();
        done.send(snapshot).unwrap();
    });
    let snapshots = completed.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(!snapshots.is_empty());
    assert!(!stream.is_finished());
    sender.send(b"data: [DONE]\n\n".to_vec()).unwrap();
    drop(sender);
    stream.join().unwrap();
    exporter.join().unwrap();
}

struct DiagnosticBrokenReader;

impl Read for DiagnosticBrokenReader {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::new(
            io::ErrorKind::ConnectionReset,
            "upstream disconnected",
        ))
    }
}

#[test]
fn diagnostics_preserve_read_failures_and_do_not_read_on_empty_buffers() {
    let directory = DiagnosticTestDirectory::new();
    let _scope = DiagnosticScope::enter(directory.log());
    let payload = attach_diagnostic_test_response(diagnostic_test_payload(
        UpstreamBody::Streaming(Box::new(DiagnosticBrokenReader)),
    ));
    let UpstreamBody::Streaming(mut reader) = payload.body else {
        panic!("expected stream")
    };
    assert_eq!(reader.read(&mut []).unwrap(), 0);
    assert_eq!(
        reader.read(&mut [0; 8]).unwrap_err().kind(),
        io::ErrorKind::ConnectionReset
    );
    drop(reader);
    let events = directory.events();
    let endings: Vec<_> = events
        .iter()
        .filter(|entry| entry["event"] == "response_stream_finished")
        .collect();
    assert_eq!(endings.len(), 1);
    assert_eq!(endings[0]["outcome"], "read_error");
}
