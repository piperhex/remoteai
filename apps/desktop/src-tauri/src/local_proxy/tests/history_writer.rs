use super::*;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc,
};

#[test]
fn bounded_under_concurrent_overflow_and_requests_a_rescan() {
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let rescans = Arc::new(AtomicUsize::new(0));
    let rescan_count = rescans.clone();
    let first = AtomicBool::new(true);
    let writer = Arc::new(
        Writer::start(
            move |work| {
                if first.swap(false, Ordering::AcqRel) {
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                }
                if matches!(work, Work::Rescan) {
                    rescan_count.fetch_add(1, Ordering::Relaxed);
                }
                Ok::<_, ()>(())
            },
            |_| panic!("unexpected error"),
        )
        .unwrap(),
    );
    writer.enqueue("blocked", None).unwrap();
    entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    thread::scope(|scope| {
        for producer in 0..16 {
            let writer = &writer;
            scope.spawn(move || {
                for request in 0..2_000 {
                    writer
                        .enqueue(&format!("session-{producer}"), Some(request))
                        .unwrap();
                }
            });
        }
    });
    {
        let state = writer.shared.state.lock().unwrap();
        assert_eq!(state.pending.len(), MAX_PENDING);
        assert!(state.key_bytes <= MAX_KEY_BYTES);
        assert!(state.rescan);
    }
    assert!(
        writer.enter().is_err(),
        "saturation must reject new history producers"
    );
    release_tx.send(()).unwrap();
    writer.flush(Duration::from_secs(2)).unwrap();
    assert!(
        writer.enter().is_ok(),
        "drained capacity must admit requests again"
    );
    writer.close(Duration::from_secs(2)).unwrap();
    assert!(rescans.load(Ordering::Relaxed) >= 1);
    assert!(writer.enqueue("after-close", None).is_err());
}

#[test]
fn byte_limit_coalesces_large_keys_without_allocating_them() {
    let (release_tx, release_rx) = mpsc::channel();
    let first = AtomicBool::new(true);
    let writer = Writer::start(
        move |_| {
            if first.swap(false, Ordering::AcqRel) {
                release_rx.recv().unwrap();
            }
            Ok::<_, ()>(())
        },
        |_| panic!("unexpected error"),
    )
    .unwrap();
    writer
        .enqueue(&"x".repeat(MAX_KEY_BYTES + 1), None)
        .unwrap();
    let state = writer.shared.state.lock().unwrap();
    assert_eq!(state.key_bytes, 0);
    assert!(state.pending.is_empty());
    drop(state);
    release_tx.send(()).unwrap();
    writer.close(Duration::from_secs(2)).unwrap();
}

#[test]
fn error_is_reported_once_retry_is_bounded_and_failed_exit_can_retry() {
    let broken = Arc::new(AtomicBool::new(true));
    let errors = Arc::new(AtomicUsize::new(0));
    let save_broken = broken.clone();
    let report_errors = errors.clone();
    let writer = Writer::start(
        move |_| {
            if save_broken.load(Ordering::Acquire) {
                Err(())
            } else {
                Ok(())
            }
        },
        move |_| {
            report_errors.fetch_add(1, Ordering::Relaxed);
        },
    )
    .unwrap();
    writer.enqueue("request", Some(1)).unwrap();
    assert!(matches!(
        writer.close(Duration::from_millis(650)),
        Err(WriterError::Timeout)
    ));
    assert_eq!(errors.load(Ordering::Relaxed), 1);
    assert!(
        writer.enter().is_err(),
        "failed database rejects new tracked requests"
    );
    broken.store(false, Ordering::Release);
    writer.flush(Duration::from_secs(2)).unwrap();
    assert!(writer.enter().is_ok());
    writer.close(Duration::from_secs(2)).unwrap();
}

#[test]
fn shutdown_waits_for_request_final_write_and_admission_is_bounded() {
    let writer = Writer::start(|_| Ok::<_, ()>(()), |_| panic!("unexpected error")).unwrap();
    let mut leases = (0..MAX_ACTIVE_REQUESTS)
        .map(|_| writer.enter().unwrap())
        .collect::<Vec<_>>();
    assert!(writer.enter().is_err());
    assert!(matches!(
        writer.close(Duration::from_millis(20)),
        Err(WriterError::Timeout)
    ));
    leases.pop();
    assert!(writer.enter().is_ok(), "timed-out exit reopens admission");
    writer.enqueue("final", Some(1)).unwrap();
    drop(leases);
    writer.close(Duration::from_secs(2)).unwrap();
}

#[test]
fn worker_panic_is_visible_and_never_triggers_inline_fallback() {
    let (reported_tx, reported_rx) = mpsc::channel();
    let writer = Writer::start(
        |_| -> Result<(), ()> { panic!("controlled worker panic") },
        move |_| {
            reported_tx.send(()).unwrap();
        },
    )
    .unwrap();
    writer.enqueue("panic", None).unwrap();
    reported_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(writer.close(Duration::from_secs(1)).is_err());
}
