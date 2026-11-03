use super::*;
use crate::cloud::credential_tests::{respond, Fixture};
use std::thread;

#[test]
fn slow_usage_upload_does_not_block_the_real_device_directory() {
    let fixture = Fixture::new();
    let snapshot: local::DeviceUsage = serde_json::from_value(json!({
        "deviceName": "fixture", "accounts": [{"accountId": "test-account",
            "accountLabel": "fixture", "samples": [], "points": []}]
    }))
    .unwrap();
    let (reports, _) =
        local::prepare_report(snapshot, local::ReportCheckpoint::default(), 0).unwrap();
    let app = fixture.app.handle().clone();
    let credentials = fixture.credentials();
    let worker = thread::spawn(move || upload_reports(&app, reports, &credentials));
    let pending = fixture.recv("/official-usage/v2/records");
    fixture.assert_directory_available();
    assert!(!worker.is_finished());
    respond(pending, 200, json!({}));
    worker.join().unwrap().unwrap();
}
