use super::*;

const SYNC_PROBE: &str = "CSW_CREDENTIAL_SYNC_PROBE";

#[test]
fn real_sync_and_polling_use_isolated_files_and_remain_responsive() {
    let directory = tempfile::tempdir().unwrap();
    let result = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "cloud::credential_tests::sync::isolated_sync_probe",
            "--nocapture",
        ])
        .env(SYNC_PROBE, "1")
        .env("CODEX_HOME", directory.path())
        .env("NO_PROXY", "127.0.0.1,localhost")
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}

#[tokio::test(flavor = "current_thread")]
async fn isolated_sync_probe() {
    if std::env::var(SYNC_PROBE).as_deref() != Ok("1") {
        return;
    }
    let fixture = Fixture::new();
    let app = fixture.app.handle().clone();
    let sync = tauri::async_runtime::spawn(cloud_sync_accounts(app));
    let pending = fixture.recv("/sync/accounts");
    fixture.assert_directory_available();
    // Exercise the actual async auth command repeatedly while the sync worker waits.
    for _ in 0..5 {
        tokio::time::sleep(Duration::from_millis(10)).await;
        let state = tokio::time::timeout(
            Duration::from_secs(1),
            get_cloud_auth_state(fixture.app.handle().clone()),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(state.authenticated);
    }
    let app = fixture.app.handle().clone();
    let mapping = tauri::async_runtime::spawn(sync_port_mappings(
        app,
        GuiCloudIdentity {
            base_url: fixture.url(),
            user_id: "first".into(),
        },
        "fixture-device".into(),
        None,
    ));
    respond(
        fixture.recv("/devices/fixture-device/port-mappings"),
        200,
        json!({"revision": 1, "mappings": [], "accepted": false}),
    );
    mapping.await.unwrap().unwrap();
    // Releasing sync with an HTTP error proves independent work finished before it.
    respond(pending, 503, json!({}));
    assert!(sync.await.unwrap().is_err());
}
