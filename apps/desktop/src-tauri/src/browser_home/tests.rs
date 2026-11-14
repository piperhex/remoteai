use super::{package, refresh, server::HomeServer, storage::Cache};
use base64::Engine;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tiny_http::{Header, Response, Server};

fn fixture() -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "revision": "11111111-1111-4111-8111-111111111111",
        "files": [{ "path": "index.html", "contentType": "text/html",
            "data": base64::engine::general_purpose::STANDARD.encode("<h1>Cached home</h1>") }],
    }))
    .unwrap()
}

#[test]
fn package_checks_all_bytes_and_rejects_unsafe_paths() {
    let bytes = fixture();
    assert!(package::decode(&bytes, &package::digest(&bytes)).is_ok());
    assert!(package::decode(&bytes, &"0".repeat(32)).is_err());
    for path in [
        "../index.html",
        "/index.html",
        "a//b",
        "a/./b",
        "C:\\a",
        "%2e%2e/file",
        "a\n.js",
    ] {
        assert!(!package::safe_path(path), "{path}");
    }
}

#[test]
fn unchanged_md5_skips_download_and_failed_update_keeps_previous_cache() {
    let bytes = fixture();
    let md5 = package::digest(&bytes);
    let server = Server::http("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.server_addr());
    let count = Arc::new(AtomicUsize::new(0));
    let requests = count.clone();
    let checksum = md5.clone();
    let handle = std::thread::spawn(move || {
        for index in 0..5 {
            let request = server.recv().unwrap();
            let body = if request.url().ends_with("/current") {
                let digest = if index >= 3 {
                    "0".repeat(32)
                } else {
                    checksum.clone()
                };
                serde_json::to_vec(&serde_json::json!({ "enabled": true, "md5": digest })).unwrap()
            } else {
                requests.fetch_add(1, Ordering::SeqCst);
                bytes.clone()
            };
            request
                .respond(
                    Response::from_data(body).with_header(
                        Header::from_bytes("Content-Type", "application/json").unwrap(),
                    ),
                )
                .unwrap();
        }
    });
    let directory = tempfile::tempdir().unwrap();
    let cache = Cache::fixture(base.clone(), directory.path().to_owned());
    assert!(cache.current().unwrap().is_none());
    assert_eq!(refresh(&cache).unwrap(), Some(md5.clone()));
    assert_eq!(refresh(&cache).unwrap(), Some(md5.clone()));
    assert_eq!(count.load(Ordering::SeqCst), 1);
    assert!(refresh(&cache).is_err());
    assert_eq!(cache.current().unwrap().unwrap().md5, md5);
    assert!(cache.read(&md5).is_ok());
    handle.join().unwrap();
    drop(cache);
    let restored = Cache::fixture(base, directory.path().to_owned());
    assert_eq!(restored.current().unwrap().unwrap().md5, md5);
    assert!(restored.read(&md5).is_ok());
}

#[test]
fn cached_home_is_served_with_script_isolation_and_module_cors() {
    let bytes = fixture();
    let md5 = package::digest(&bytes);
    let home = package::decode(&bytes, &md5).unwrap();
    let server = HomeServer::start("https://example.test".into(), md5, home).unwrap();
    let client = reqwest::blocking::Client::new();
    let response = client.get(server.view().url).send().unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let policy = response.headers()["content-security-policy"]
        .to_str()
        .unwrap();
    assert!(policy.contains("sandbox allow-scripts"));
    assert!(!policy.contains("allow-same-origin"));
    assert_eq!(response.headers()["access-control-allow-origin"], "*");
    assert!(response.text().unwrap().contains("Cached home"));
}
