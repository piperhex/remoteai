use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::json;
use std::{
    sync::atomic::{AtomicUsize, Ordering},
    thread,
};

struct Fixture {
    _directory: tempfile::TempDir,
    paths: Paths,
    client: Client,
    server: Arc<tiny_http::Server>,
    id: String,
    auth: Value,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let paths = Paths {
            codex_home: root.join("home"),
            current_auth: root.join("home/auth.json"),
            current_config: root.join("home/config.toml"),
            accounts: root.join("accounts"),
            providers: root.join("providers"),
            config_backup: root.join("backup.toml"),
            state_file: root.join("state.json"),
        };
        let token = access_token("initial");
        let mut auth = json!({"tokens": {"id_token": token, "access_token": token,
            "refresh_token": "initial-rt"}, "last_refresh": Utc::now().to_rfc3339()});
        canonicalize_chatgpt_auth(&mut auth).unwrap();
        let (_, _, _, id) = account_fields(&auth).unwrap();
        write_json_atomic(&managed_auth_path(&paths, &id), &auth).unwrap();
        Self {
            _directory: directory,
            paths,
            id,
            auth,
            client: Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap(),
            server: Arc::new(tiny_http::Server::http("127.0.0.1:0").unwrap()),
        }
    }

    fn url(&self) -> String {
        format!("http://{}", self.server.server_addr())
    }
    fn context(&self) -> AccountAuthRequest<'_> {
        AccountAuthRequest {
            client: &self.client,
            paths: &self.paths,
            id: &self.id,
        }
    }
}

fn access_token(marker: &str) -> String {
    let claims = json!({"sub": "usage-user", "email": "usage@example.test", "marker": marker,
        "exp": (Utc::now() + chrono::Duration::hours(1)).timestamp(),
        "https://api.openai.com/auth": {"chatgpt_account_id": "usage-workspace"}});
    format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()))
}

fn serve(server: Arc<tiny_http::Server>, statuses: Vec<u16>) -> thread::JoinHandle<Vec<Value>> {
    thread::spawn(move || {
        statuses
            .into_iter()
            .map(|status| {
                let mut request = server
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap()
                    .unwrap();
                let mut body = String::new();
                request.as_reader().read_to_string(&mut body).unwrap();
                let input = serde_json::from_str(&body).unwrap_or(Value::Null);
                let payload = if request.method() == &tiny_http::Method::Post {
                    json!({"access_token": access_token("rotated"), "refresh_token": "rotated-rt"})
                } else {
                    json!({})
                };
                request
                    .respond(
                        tiny_http::Response::from_string(payload.to_string())
                            .with_status_code(status)
                            .with_header(
                                tiny_http::Header::from_bytes("Content-Type", "application/json")
                                    .unwrap(),
                            ),
                    )
                    .unwrap();
                input
            })
            .collect()
    })
}

#[test]
fn proactive_refresh_persists_rotated_tokens_and_notifies_before_usage() {
    let fixture = Fixture::new();
    let url = fixture.url();
    let mut initial = fixture.auth.clone();
    initial["tokens"]["access_token"] = "opaque-access".into();
    initial["last_refresh"] = (Utc::now() - chrono::Duration::days(9)).to_rfc3339().into();
    write_json_atomic(&managed_auth_path(&fixture.paths, &fixture.id), &initial).unwrap();
    let mut request = RequestAuth::new(initial);
    let notifications = Arc::new(AtomicUsize::new(0));
    let recorded = Arc::clone(&notifications);
    request.on_change = Some(Box::new(move || {
        recorded.fetch_add(1, Ordering::SeqCst);
    }));
    let worker = serve(Arc::clone(&fixture.server), vec![200]);
    crate::codex_api::with_refresh_endpoint(&url, || {
        refresh_auth_if_needed(&fixture.client, &mut request, &fixture.paths, &fixture.id).unwrap();
    });
    assert_eq!(worker.join().unwrap()[0]["refresh_token"], "initial-rt");
    let saved = read_json(&managed_auth_path(&fixture.paths, &fixture.id)).unwrap();
    assert_eq!(saved["tokens"]["refresh_token"], "rotated-rt");
    assert!(saved["last_refresh"] != fixture.auth["last_refresh"]);
    request.persist(&fixture.paths, &fixture.id).unwrap();
    assert_eq!(notifications.load(Ordering::SeqCst), 1);
}

#[test]
fn unauthorized_usage_retries_reloaded_credentials_before_refreshing() {
    let fixture = Fixture::new();
    let url = fixture.url();
    let mut fresh = fixture.auth.clone();
    fresh["tokens"]["access_token"] = access_token("new-login").into();
    fresh["tokens"]["refresh_token"] = "new-login-rt".into();
    let mut request = RequestAuth::new(fixture.auth.clone());
    let worker = serve(Arc::clone(&fixture.server), vec![401, 200]);
    let mut attempts = 0;
    let response = request
        .request_with_recovery(fixture.context(), |value| {
            attempts += 1;
            if attempts == 2 {
                assert_eq!(value, &fresh);
            }
            let response = fixture
                .client
                .get(&url)
                .send()
                .map_err(|error| error.to_string())?;
            if attempts == 1 {
                write_json_atomic(&managed_auth_path(&fixture.paths, &fixture.id), &fresh)?;
            }
            Ok(response)
        })
        .unwrap();
    assert!(response.status().is_success());
    assert_eq!(worker.join().unwrap(), vec![Value::Null, Value::Null]);
}

#[test]
fn a_second_unauthorized_response_refreshes_the_reloaded_rt() {
    let fixture = Fixture::new();
    let url = fixture.url();
    let mut fresh = fixture.auth.clone();
    fresh["tokens"]["access_token"] = access_token("new-login").into();
    fresh["tokens"]["refresh_token"] = "new-login-rt".into();
    let mut request = RequestAuth::new(fixture.auth.clone());
    let worker = serve(Arc::clone(&fixture.server), vec![401, 401, 200, 200]);
    let mut attempts = 0;
    let response = crate::codex_api::with_refresh_endpoint(&url, || {
        request.request_with_recovery(fixture.context(), |_| {
            attempts += 1;
            let response = fixture
                .client
                .get(&url)
                .send()
                .map_err(|error| error.to_string())?;
            if attempts == 1 {
                write_json_atomic(&managed_auth_path(&fixture.paths, &fixture.id), &fresh)?;
            }
            Ok(response)
        })
    })
    .unwrap();
    assert!(response.status().is_success());
    assert_eq!(worker.join().unwrap()[2]["refresh_token"], "new-login-rt");
    assert_eq!(
        read_json(&managed_auth_path(&fixture.paths, &fixture.id)).unwrap()["tokens"]
            ["refresh_token"],
        "rotated-rt"
    );
}

#[test]
fn failed_usage_still_persists_and_announces_successful_token_rotation() {
    let fixture = Fixture::new();
    let url = fixture.url();
    let mut request = RequestAuth::new(fixture.auth.clone());
    let notifications = Arc::new(AtomicUsize::new(0));
    let recorded = Arc::clone(&notifications);
    request.on_change = Some(Box::new(move || {
        recorded.fetch_add(1, Ordering::SeqCst);
    }));
    let worker = serve(Arc::clone(&fixture.server), vec![401, 200, 401]);
    let response = crate::codex_api::with_refresh_endpoint(&url, || {
        request.request_with_recovery(fixture.context(), |_| {
            fixture
                .client
                .get(&url)
                .send()
                .map_err(|error| error.to_string())
        })
    })
    .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
    assert_eq!(worker.join().unwrap().len(), 3);
    assert_eq!(notifications.load(Ordering::SeqCst), 1);
    assert_eq!(
        read_json(&managed_auth_path(&fixture.paths, &fixture.id)).unwrap()["tokens"]
            ["refresh_token"],
        "rotated-rt"
    );
}

#[test]
fn simultaneous_current_and_global_refreshes_rotate_a_managed_rt_only_once() {
    let fixture = Fixture::new();
    let url = fixture.url();
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let (paths, id, auth, client, url, barrier) = (
                fixture.paths.clone(),
                fixture.id.clone(),
                fixture.auth.clone(),
                fixture.client.clone(),
                url.clone(),
                Arc::clone(&barrier),
            );
            thread::spawn(move || {
                let mut request = RequestAuth::new(auth);
                barrier.wait();
                crate::codex_api::with_refresh_endpoint(&url, || {
                    request.refresh(&client, &paths, &id)
                })
                .unwrap();
                request.value
            })
        })
        .collect();
    let server = serve(Arc::clone(&fixture.server), vec![200]);
    for worker in workers {
        assert_eq!(
            worker.join().unwrap()["tokens"]["refresh_token"],
            "rotated-rt"
        );
    }
    assert_eq!(server.join().unwrap().len(), 1);
}
