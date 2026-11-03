use super::*;

#[test]
fn slow_sync_request_does_not_serialize_device_reads_or_auth_state() {
    let fixture = Fixture::new();
    let slow = fixture.request("/sync/accounts");
    let pending = fixture.recv("/sync/accounts");
    fixture.assert_directory_available();
    assert!(
        get_cloud_auth_state_blocking(fixture.app.handle())
            .unwrap()
            .authenticated
    );
    assert!(!slow.is_finished());
    respond(pending, 200, json!({"accounts": []}));
    slow.join().unwrap().unwrap();
}

#[test]
fn concurrent_401s_share_one_rotation_and_retry_with_the_new_access_token() {
    let fixture = Fixture::new();
    let requests = (0..8)
        .map(|_| fixture.request("/protected"))
        .collect::<Vec<_>>();
    let pending = (0..8)
        .map(|_| fixture.recv("/protected"))
        .collect::<Vec<_>>();
    for request in pending {
        respond(request, 401, json!({}));
    }
    let refresh = fixture.recv("/auth/refresh");
    fixture.assert_directory_available();
    respond(refresh, 200, rotated_tokens());
    for _ in 0..8 {
        let request = fixture.recv("/protected");
        assert!(request
            .headers()
            .iter()
            .any(|header| header.field.equiv("Authorization")
                && header.value.as_str() == "Bearer access-rotated"));
        respond(request, 200, json!({"ok": true}));
    }
    for request in requests {
        request.join().unwrap().unwrap();
    }
    assert_eq!(
        fixture.credentials().refresh_token.as_deref(),
        Some("refresh-rotated")
    );
    assert!(fixture
        .server
        .recv_timeout(Duration::from_millis(100))
        .unwrap()
        .is_none());
}

#[test]
fn concurrent_refresh_failures_are_shared_but_a_later_operation_can_retry() {
    let fixture = Fixture::new();
    let requests = (0..4)
        .map(|_| fixture.request("/protected"))
        .collect::<Vec<_>>();
    let pending = (0..4)
        .map(|_| fixture.recv("/protected"))
        .collect::<Vec<_>>();
    for request in pending {
        respond(request, 401, json!({}));
    }
    respond(fixture.recv("/auth/refresh"), 503, json!({}));
    for request in requests {
        assert!(request.join().unwrap().is_err());
    }
    assert!(fixture
        .server
        .recv_timeout(Duration::from_millis(100))
        .unwrap()
        .is_none());
    assert!(
        get_cloud_auth_state_blocking(fixture.app.handle())
            .unwrap()
            .authenticated
    );
    let later = fixture.request("/protected");
    respond(fixture.recv("/protected"), 401, json!({}));
    respond(fixture.recv("/auth/refresh"), 200, rotated_tokens());
    respond(fixture.recv("/protected"), 200, json!({}));
    later.join().unwrap().unwrap();
}

#[test]
fn a_slow_old_success_cannot_restore_revoked_tokens_or_stale_settings() {
    let fixture = Fixture::new();
    let slow = fixture.request("/slow");
    let pending = fixture.recv("/slow");
    let refresh = fixture.request("/protected");
    respond(fixture.recv("/protected"), 401, json!({}));
    respond(fixture.recv("/auth/refresh"), 200, rotated_tokens());
    respond(fixture.recv("/protected"), 200, json!({}));
    refresh.join().unwrap().unwrap();
    let mut settings = read_app_settings(fixture.app.handle()).unwrap();
    settings.cloud_last_sync_at = Some("2099-01-01T00:00:00Z".into());
    write_app_settings(fixture.app.handle(), &settings).unwrap();
    respond(pending, 200, json!({}));
    slow.join().unwrap().unwrap();
    let (current, credentials) = cloud_snapshot(fixture.app.handle()).unwrap();
    assert_eq!(current.cloud_last_sync_at, settings.cloud_last_sync_at);
    assert_eq!(
        credentials.refresh_token.as_deref(),
        Some("refresh-rotated")
    );
}

#[test]
fn rejection_expires_only_the_current_session_and_does_not_retry_business_io() {
    for status in [401, 403] {
        let fixture = Fixture::new();
        let request = fixture.request("/protected");
        respond(fixture.recv("/protected"), 401, json!({}));
        respond(fixture.recv("/auth/refresh"), status, json!({}));
        assert!(request.join().unwrap().unwrap_err().contains("expired"));
        let state = get_cloud_auth_state_blocking(fixture.app.handle()).unwrap();
        assert!(state.session_expired);
        assert!(!state.authenticated);
        assert!(fixture.credentials().refresh_token.is_none());
        assert!(fixture
            .server
            .recv_timeout(Duration::from_millis(100))
            .unwrap()
            .is_none());
    }
}
