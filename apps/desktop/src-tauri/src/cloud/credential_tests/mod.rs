//! All fixtures use loopback HTTP and unique application directories.
use super::*;
use std::{sync::mpsc, thread};

mod concurrency;
mod lifecycle;
mod sync;

pub(super) struct Fixture {
    pub(super) app: tauri::App<tauri::test::MockRuntime>,
    pub(super) server: tiny_http::Server,
}

impl Fixture {
    pub(super) fn new() -> Self {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().identifier =
            format!("com.codex-switch.credential-test.{}", Uuid::new_v4());
        let fixture = Self {
            app: tauri::test::mock_builder().build(context).unwrap(),
            server: tiny_http::Server::http("127.0.0.1:0").unwrap(),
        };
        let settings = AppSettings {
            cloud_base_url: Some(fixture.url()),
            ..AppSettings::default()
        };
        write_app_settings(fixture.app.handle(), &settings).unwrap();
        fixture.login("first");
        fixture
    }

    pub(super) fn url(&self) -> String {
        format!("http://{}", self.server.server_addr())
    }

    pub(super) fn login(&self, owner: &str) {
        let app = self.app.handle();
        let (_, ticket) = authentication_session::begin_login(app).unwrap();
        authentication_session::commit_login(app, &ticket, tokens(owner)).unwrap();
    }

    pub(super) fn recv(&self, path: &str) -> tiny_http::Request {
        let request = self
            .server
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap_or_else(|| panic!("missing fixture request: {path}"));
        assert_eq!(request.url(), path);
        request
    }

    pub(super) fn request(&self, path: &'static str) -> thread::JoinHandle<Result<Value, String>> {
        let app = self.app.handle().clone();
        thread::spawn(move || {
            let (mut settings, mut credentials) = cloud_snapshot(&app)?;
            let response = cloud_request(
                &app,
                &client(),
                &mut settings,
                &mut credentials,
                Method::GET,
                path,
                None,
            )?;
            let body = response.error_for_status()?.json()?;
            persist_cloud_sync(&app, &settings, &credentials)?;
            Ok(body)
        })
    }

    pub(super) fn assert_directory_available(&self) {
        let app = self.app.handle().clone();
        let (send, receive) = mpsc::channel();
        let worker = thread::spawn(move || {
            let result = tauri::async_runtime::block_on(codex_gui_devices(app));
            send.send(result.map(|value| serde_json::to_value(value).unwrap()))
                .unwrap();
        });
        respond(self.recv("/devices"), 200, json!({"devices": []}));
        let value = receive
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .unwrap();
        assert_eq!(value["identity"]["userId"], "first");
        worker.join().unwrap();
    }

    pub(super) fn credentials(&self) -> CloudCredentials {
        cloud_snapshot(self.app.handle()).unwrap().1
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let root = self.app.path().app_data_dir().unwrap();
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("com.codex-switch.credential-test."));
        if root.exists() {
            fs::remove_dir_all(root).unwrap();
        }
    }
}

pub(super) fn client() -> Client {
    Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap()
}

pub(super) fn tokens(owner: &str) -> CloudTokenResponse {
    CloudTokenResponse {
        access_token: format!("access-{owner}"),
        refresh_token: format!("refresh-{owner}"),
        user: Some(CloudUserResponse {
            id: owner.into(),
            email: format!("{owner}@example.test"),
        }),
    }
}

pub(super) fn respond(request: tiny_http::Request, status: u16, body: Value) {
    request
        .respond(tiny_http::Response::from_string(body.to_string()).with_status_code(status))
        .unwrap();
}

pub(super) fn rotated_tokens() -> Value {
    json!({"accessToken": "access-rotated", "refreshToken": "refresh-rotated",
        "user": {"id": "first", "email": "first@example.test"}})
}
