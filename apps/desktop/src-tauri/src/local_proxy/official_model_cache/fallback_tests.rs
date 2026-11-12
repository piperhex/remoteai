use super::*;
use crate::local_proxy::{
    error_messages, send_with_timeout_retries, stream_response, DiagnosticScope,
};
use tauri::Manager;

struct TestApp(tauri::App<tauri::test::MockRuntime>);

impl TestApp {
    fn new(base: String) -> Self {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier =
            format!("dev.codex.switch.model-fallback.{}", uuid::Uuid::new_v4());
        let app = tauri::test::mock_builder().build(context).unwrap();
        crate::storage::write_app_settings(
            app.handle(),
            &crate::models::AppSettings {
                cloud_base_url: Some(base),
                ..Default::default()
            },
        )
        .unwrap();
        Self(app)
    }
}

impl Drop for TestApp {
    fn drop(&mut self) {
        let root = self.0.path().app_data_dir().unwrap();
        assert_eq!(
            root.file_name().unwrap().to_str().unwrap(),
            self.0.config().identifier
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}

fn events(path: &std::path::Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn official_http_502_reaches_admin_and_records_success() {
    let (official_url, official) = server(502, b"bad gateway".to_vec());
    let (admin_url, admin) = server(200, CATALOG.to_vec());
    let client = Client::builder().no_proxy().build().unwrap();
    let directory = tempfile::tempdir().unwrap();
    let log = directory.path().join("diagnostics.jsonl");
    let _scope = DiagnosticScope::enter(log.clone());
    let payload = prefer_official(
        || {
            let response =
                send_with_timeout_retries(|| client.get(official_url.clone()), "models")?;
            stream_response(response)
        },
        || request_catalog(&client, admin_url),
    )
    .unwrap();
    assert_catalog(payload, "catalog-v3");
    official.join().unwrap();
    admin.join().unwrap();
    let entries = events(&log);
    let started = entries
        .iter()
        .find(|entry| entry["event"] == "model_catalog_admin_fallback_started")
        .unwrap();
    assert!(started["officialError"]
        .as_str()
        .unwrap()
        .contains("HTTP 502"));
    let completed = entries.last().unwrap();
    assert_eq!(completed["event"], "model_catalog_admin_fallback_succeeded");
    assert_eq!(completed["status"], 200);
    assert_eq!(completed["requestId"], started["requestId"]);
}

#[test]
fn official_dns_failure_reaches_admin_and_keeps_diagnostic_details() {
    let (url, admin) = server(200, CATALOG.to_vec());
    let app = TestApp::new(url.origin().ascii_serialization());
    let directory = tempfile::tempdir().unwrap();
    let log = directory.path().join("diagnostics.jsonl");
    let _scope = DiagnosticScope::enter(log.clone());
    let payload = with_fallback(app.0.handle(), || {
        Err(concat!(
            "Official Codex proxy request failed: ",
            "https://private.example/models?token=private-token: dns error (os error 11001)"
        )
        .into())
    })
    .unwrap();
    assert_catalog(payload, "catalog-v3");
    admin.join().unwrap();
    let entries = events(&log);
    assert!(entries[0]["officialError"]
        .as_str()
        .unwrap()
        .contains("dns error"));
    assert_eq!(
        entries[1]["event"],
        "model_catalog_admin_fallback_succeeded"
    );
    let recorded = std::fs::read_to_string(&log).unwrap();
    assert!(recorded.contains("https://private.example/models?token=private-token"));
}

#[test]
fn failed_admin_request_keeps_both_causes_in_diagnostics_and_a_safe_gui_message() {
    let (url, admin) = server(503, b"private response details".to_vec());
    let client = Client::builder().no_proxy().build().unwrap();
    let directory = tempfile::tempdir().unwrap();
    let log = directory.path().join("diagnostics.jsonl");
    let _scope = DiagnosticScope::enter(log.clone());
    let error = prefer_official(
        || Err("Official Codex proxy request failed: dns error (os error 11001)".into()),
        || request_catalog(&client, url),
    )
    .err()
    .unwrap();
    admin.join().unwrap();
    let message = error_messages::gui(&error);
    assert!(message.contains("无法解析上游服务的地址"), "{message}");
    assert!(message.contains("HTTP 503"), "{message}");
    assert!(message.contains("备用模型列表"), "{message}");
    let entries = events(&log);
    assert!(entries[0]["officialError"]
        .as_str()
        .unwrap()
        .contains("dns error"));
    assert_eq!(entries[1]["event"], "model_catalog_admin_fallback_failed");
    assert!(entries[1]["causes"].to_string().contains("503"));
    assert_eq!(entries[0]["requestId"], entries[1]["requestId"]);
    assert!(!std::fs::read_to_string(&log)
        .unwrap()
        .contains("private response details"));
}
