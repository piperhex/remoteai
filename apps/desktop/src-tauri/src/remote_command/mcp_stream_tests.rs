use super::*;
use std::{
    io::Cursor,
    sync::{Arc, Barrier},
    time::Duration,
};

#[test]
fn saturated_dispatch_rejects_excess_without_unbounded_workers() {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    struct Output {
        bytes: Vec<u8>,
        rejected: Arc<AtomicBool>,
    }
    impl Write for Output {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            if self.bytes.windows(7).any(|part| part == b"\"error\"") {
                self.rejected.store(true, Ordering::Release);
            }
            Ok(())
        }
    }
    let rejected = Arc::new(AtomicBool::new(false));
    let mut output = Output {
        bytes: Vec::new(),
        rejected: rejected.clone(),
    };
    let active = AtomicUsize::new(0);
    let peak = AtomicUsize::new(0);
    let input = (0..40)
        .map(|id| json!({"id":id}).to_string() + "\n")
        .collect::<String>();
    run(Cursor::new(input), &mut output, |request| {
        let count = active.fetch_add(1, Ordering::AcqRel) + 1;
        peak.fetch_max(count, Ordering::AcqRel);
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !rejected.load(Ordering::Acquire) {
            assert!(std::time::Instant::now() < deadline);
            thread::sleep(Duration::from_millis(5));
        }
        active.fetch_sub(1, Ordering::AcqRel);
        Ok(request.clone())
    })
    .unwrap();
    assert!(rejected.load(Ordering::Acquire));
    assert!(peak.load(Ordering::Acquire) <= MAX_CONCURRENT_COMMANDS);
    assert_eq!(String::from_utf8(output.bytes).unwrap().lines().count(), 40);
}

#[test]
fn eight_tool_requests_overlap_and_stdout_preserves_json_ids() {
    let input = (0..8)
        .map(|id| json!({"jsonrpc":"2.0", "id":id, "method":"tools/call"}).to_string() + "\n")
        .collect::<String>();
    let barrier = Arc::new(Barrier::new(8));
    let mut output = Vec::new();
    run(Cursor::new(input), &mut output, |request| {
        barrier.wait();
        let id = request["id"].as_u64().unwrap();
        thread::sleep(Duration::from_millis((7 - id) * 30));
        Ok(json!({"id":id, "stdout":"诊断".repeat(16*1024)}))
    })
    .unwrap();
    let responses: Vec<Value> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(responses.len(), 8);
    assert_ne!(responses[0]["id"], 0);
    let mut ids = std::collections::HashSet::new();
    for response in responses {
        assert_eq!(response["id"], response["result"]["id"]);
        assert_eq!(
            response["result"]["stdout"].as_str().unwrap().len(),
            6 * 16 * 1024
        );
        assert!(ids.insert(response["id"].as_u64().unwrap()));
    }
}

#[test]
fn oversized_input_is_rejected_before_dispatch() {
    let input = vec![b'x'; REQUEST_BYTES as usize + 1];
    assert!(matches!(
        run(Cursor::new(input), Vec::new(), |_| panic!(
            "must not dispatch"
        )),
        Err(RemoteError::InvalidRequest)
    ));
}
