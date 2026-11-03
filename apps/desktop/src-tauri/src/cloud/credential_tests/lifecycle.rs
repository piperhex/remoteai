use super::*;
use std::io::{Read, Write};

#[test]
fn rejection_of_old_credentials_does_not_cancel_a_new_login_already_in_progress() {
    let fixture = Fixture::new();
    let old = fixture.request("/protected");
    respond(fixture.recv("/protected"), 401, json!({}));
    let refresh = fixture.recv("/auth/refresh");
    let app = fixture.app.handle();
    let (_, ticket) = authentication_session::begin_login(app).unwrap();
    respond(refresh, 403, json!({}));
    assert!(old.join().unwrap().is_err());
    authentication_session::commit_login(app, &ticket, tokens("second")).unwrap();
    assert_eq!(
        fixture.credentials().access_token.as_deref(),
        Some("access-second")
    );
    assert!(!get_cloud_auth_state_blocking(app).unwrap().session_expired);
}

#[test]
fn a_failed_login_attempt_does_not_invalidate_the_current_sessions_pending_rotation() {
    let fixture = Fixture::new();
    let slow = fixture.request("/protected");
    respond(fixture.recv("/protected"), 401, json!({}));
    let refresh = fixture.recv("/auth/refresh");
    let app = fixture.app.handle().clone();
    let (settings, _ticket) = authentication_session::begin_login(&app).unwrap();
    let login = thread::spawn(move || {
        client()
            .post(endpoint(&settings, "/auth/login").unwrap())
            .send()
            .unwrap()
            .status()
    });
    respond(fixture.recv("/auth/login"), 401, json!({}));
    assert_eq!(login.join().unwrap(), StatusCode::UNAUTHORIZED);
    respond(refresh, 200, rotated_tokens());
    respond(fixture.recv("/protected"), 200, json!({}));
    slow.join().unwrap().unwrap();
    assert_eq!(
        fixture.credentials().refresh_token.as_deref(),
        Some("refresh-rotated")
    );
    assert!(
        get_cloud_auth_state_blocking(fixture.app.handle())
            .unwrap()
            .authenticated
    );
}

#[test]
fn logout_account_and_server_changes_reject_slow_responses_without_borrowing_new_tokens() {
    for transition in ["logout", "account", "server", "same-account"] {
        let fixture = Fixture::new();
        let slow = fixture.request("/slow");
        let pending = fixture.recv("/slow");
        match transition {
            "logout" => {
                authentication_session::logout_local(fixture.app.handle()).unwrap();
            }
            "account" => fixture.login("second"),
            "same-account" => fixture.login("first"),
            _ => {
                set_cloud_base_url_blocking(fixture.app.handle(), "http://127.0.0.1:1".into())
                    .unwrap();
                fixture.login("second");
            }
        }
        respond(pending, 401, json!({}));
        assert!(slow.join().unwrap().is_err());
        assert!(fixture
            .server
            .recv_timeout(Duration::from_millis(100))
            .unwrap()
            .is_none());
        let credentials = fixture.credentials();
        assert_ne!(
            credentials.refresh_token.as_deref(),
            Some("refresh-rotated")
        );
        if transition == "logout" {
            assert!(credentials.access_token.is_none());
        }
    }
}

#[test]
fn stale_refresh_rejection_cannot_expire_a_new_login() {
    let fixture = Fixture::new();
    let slow = fixture.request("/protected");
    respond(fixture.recv("/protected"), 401, json!({}));
    let pending = fixture.recv("/auth/refresh");
    fixture.login("second");
    respond(pending, 403, json!({}));
    assert!(slow.join().unwrap().is_err());
    let state = get_cloud_auth_state_blocking(fixture.app.handle()).unwrap();
    assert_eq!(state.user_id.as_deref(), Some("second"));
    assert!(state.authenticated);
    assert!(!state.session_expired);
}

#[test]
fn new_login_refresh_does_not_wait_for_old_refresh_and_discarded_rotation_is_revoked() {
    let fixture = Fixture::new();
    let slow = fixture.request("/protected");
    respond(fixture.recv("/protected"), 401, json!({}));
    let pending = fixture.recv("/auth/refresh");
    fixture.login("second");
    let current = fixture.request("/protected");
    respond(fixture.recv("/protected"), 401, json!({}));
    respond(
        fixture.recv("/auth/refresh"),
        200,
        json!({"accessToken": "access-new",
        "refreshToken": "refresh-new", "user": {"id": "second", "email": "second@example.test"}}),
    );
    respond(fixture.recv("/protected"), 200, json!({}));
    current.join().unwrap().unwrap();
    assert!(!slow.is_finished());
    respond(pending, 200, rotated_tokens());
    let mut revoke = fixture.recv("/auth/logout");
    let body: Value = serde_json::from_reader(revoke.as_reader()).unwrap();
    assert_eq!(body["refreshToken"], "refresh-rotated");
    respond(revoke, 200, json!({}));
    assert!(slow.join().unwrap().is_err());
    assert_eq!(
        fixture.credentials().refresh_token.as_deref(),
        Some("refresh-new")
    );
}

#[test]
fn a_delayed_login_cannot_overwrite_a_newer_login_or_reappear_after_logout() {
    for logout in [false, true] {
        let fixture = Fixture::new();
        let app = fixture.app.handle().clone();
        let (settings, ticket) = authentication_session::begin_login(&app).unwrap();
        let slow = thread::spawn(move || {
            let response = client()
                .post(endpoint(&settings, "/auth/login").unwrap())
                .send()
                .unwrap();
            let tokens = response.json().unwrap();
            authentication_session::commit_login(&app, &ticket, tokens)
        });
        let pending = fixture.recv("/auth/login");
        if logout {
            authentication_session::logout_local(fixture.app.handle()).unwrap();
        } else {
            fixture.login("second");
        }
        respond(pending, 200, rotated_tokens());
        assert!(slow.join().unwrap().is_err());
        assert_eq!(
            fixture.credentials().access_token.as_deref(),
            if logout { None } else { Some("access-second") }
        );
    }
}

#[test]
fn identity_is_checked_after_a_slow_response_body_and_before_local_commit() {
    let fixture = Fixture::new();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    set_cloud_base_url_blocking(
        fixture.app.handle(),
        format!("http://{}", listener.local_addr().unwrap()),
    )
    .unwrap();
    fixture.login("first");
    let credentials = fixture.credentials();
    let (headers_sent, headers_received) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            socket.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n")
            .unwrap();
        socket.flush().unwrap();
        headers_sent.send(()).unwrap();
        released.recv_timeout(Duration::from_secs(5)).unwrap();
        socket.write_all(b"{}").unwrap();
    });
    let slow = fixture.request("/slow-body");
    headers_received
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    authentication_session::logout_local(fixture.app.handle()).unwrap();
    release.send(()).unwrap();
    assert!(slow.join().unwrap().is_err());
    server.join().unwrap();
    let mut committed = false;
    assert!(with_cloud_session(fixture.app.handle(), &credentials, || {
        committed = true;
        Ok(())
    })
    .is_err());
    assert!(!committed);
}
