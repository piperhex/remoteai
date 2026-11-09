use super::*;
use crate::storage::{managed_auth_path, read_state, write_managed_auth_if_changed};

const PROBE: &str = "CSW_REFRESHED_ACCOUNT_SYNC_PROBE";

#[test]
fn refreshed_credentials_upload_and_download_without_blocking_polling_or_switching_accounts() {
    let directory = tempfile::tempdir().unwrap();
    let result = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "cloud::credential_tests::refreshed_accounts::isolated_refreshed_account_probe",
            "--nocapture",
        ])
        .env(PROBE, "1")
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

fn install_account(fixture: &Fixture) -> String {
    let payload = json!({"sub": "refreshed-user", "email": "refresh@example.test",
        "https://api.openai.com/auth": {"chatgpt_account_id": "refreshed-workspace"}});
    let token = format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(payload.to_string()));
    let mut auth = json!({"tokens": {"access_token": token, "id_token": token,
        "refresh_token": "rotated-rt"}, "last_refresh": Utc::now().to_rfc3339()});
    canonicalize_chatgpt_auth(&mut auth).unwrap();
    let (_, _, _, id) = account_fields(&auth).unwrap();
    write_managed_auth_if_changed(&resolve_paths(fixture.app.handle()).unwrap(), &id, &auth)
        .unwrap();
    id
}

fn upload_committed_credentials(fixture: &Fixture, id: &str) {
    let upload = refreshed_account_uploader(fixture.app.handle(), id).unwrap();
    upload();
    let mut pending = fixture.recv(&format!("/sync/accounts/{id}"));
    let mut body = String::new();
    pending.as_reader().read_to_string(&mut body).unwrap();
    let payload: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(pending.method(), &tiny_http::Method::Put);
    assert_eq!(payload["auth"]["tokens"]["refresh_token"], "rotated-rt");
    assert!(payload["fieldModifiedAt"]["auth"].as_str().is_some());
    fixture.assert_directory_available();
    respond(pending, 200, json!({"id": id}));
}

fn newer_remote_account(fixture: &Fixture, id: &str) -> CloudAccountPayload {
    let mut remote = collect_local_account(fixture.app.handle(), id).unwrap();
    remote.auth["tokens"]["refresh_token"] = "newer-remote-rt".into();
    let modified = (Utc::now() + chrono::Duration::minutes(1)).to_rfc3339();
    remote.auth["last_refresh"] = modified.clone().into();
    remote.field_modified_at.auth = modified.clone();
    remote.last_modified_at = modified;
    remote.active = true;
    remote
}

async fn download_notification(fixture: &Fixture, id: &str) {
    let app = fixture.app.handle().clone();
    let id = id.to_owned();
    let remote = newer_remote_account(fixture, &id);
    let pull = tauri::async_runtime::spawn(async move {
        pull_refreshed_account(&app, "access-first", &id).await
    });
    let pending = fixture.recv("/sync/accounts");
    fixture.assert_directory_available();
    respond(
        pending,
        200,
        json!({"accounts": [remote], "deletedAccountIds": []}),
    );
    pull.await.unwrap().unwrap();
    let paths = resolve_paths(fixture.app.handle()).unwrap();
    let saved = read_json(&managed_auth_path(&paths, &remote.id)).unwrap();
    assert_eq!(saved["tokens"]["refresh_token"], "newer-remote-rt");
    assert!(read_state(&paths).active_account_id.is_none());
}

async fn discard_download_after_cloud_account_switch(fixture: &Fixture, id: &str) {
    let app = fixture.app.handle().clone();
    let id = id.to_owned();
    let mut remote = newer_remote_account(fixture, &id);
    remote.auth["tokens"]["refresh_token"] = "previous-cloud-user-rt".into();
    let pull = tauri::async_runtime::spawn(async move {
        pull_refreshed_account(&app, "access-first", &id).await
    });
    let pending = fixture.recv("/sync/accounts");
    fixture.login("second");
    respond(
        pending,
        200,
        json!({"accounts": [remote], "deletedAccountIds": []}),
    );
    assert!(pull.await.unwrap().is_err());
    let paths = resolve_paths(fixture.app.handle()).unwrap();
    assert_eq!(
        read_json(&managed_auth_path(&paths, &remote.id)).unwrap()["tokens"]["refresh_token"],
        "newer-remote-rt"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn isolated_refreshed_account_probe() {
    if std::env::var(PROBE).as_deref() != Ok("1") {
        return;
    }
    let fixture = Fixture::new();
    let id = install_account(&fixture);
    upload_committed_credentials(&fixture, &id);
    download_notification(&fixture, &id).await;
    discard_download_after_cloud_account_switch(&fixture, &id).await;
}
