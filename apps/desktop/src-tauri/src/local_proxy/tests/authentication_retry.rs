#[test]
fn authentication_retry_switches_before_backoff_even_without_a_429_budget() {
    for status in [401, 403] {
        let mut attempts = 0;
        let response = retry_upstream_request_with(
            Duration::ZERO,
            || {
                attempts += 1;
                Ok(official_payload(
                    if attempts == 1 { status } else { 200 },
                    0,
                ))
            },
            |_, event| {
                let UpstreamQuotaEvent::Retry {
                    exhausted_account_ids,
                } = event
                else {
                    panic!("authentication failures must not time out as rate limits")
                };
                assert_eq!(exhausted_account_ids, HashSet::from(["current".into()]));
                true
            },
            |_| panic!("authentication failures must switch immediately"),
        )
        .unwrap();
        assert_eq!((response.status, attempts), (200, 2));
    }
}

#[test]
fn authentication_retry_preserves_original_response_when_no_backup_can_be_selected() {
    for status in [401, 403] {
        let mut attempts = 0;
        let response = retry_upstream_request_with(
            Duration::ZERO,
            || {
                attempts += 1;
                let mut response = official_payload(status, 0);
                response.body = UpstreamBody::Buffered(b"original authentication error".to_vec());
                Ok(response)
            },
            |_, _| false,
            |_| panic!("no authentication backoff"),
        )
        .unwrap();
        assert_eq!((response.status, attempts), (status, 1));
        let UpstreamBody::Buffered(body) = response.body else {
            panic!("buffered error expected")
        };
        assert_eq!(body, b"original authentication error");
    }
}

#[test]
fn authentication_retry_excludes_each_failed_account_and_bounds_cycles() {
    let mut attempts = 0;
    let mut switches = 0;
    let response = retry_upstream_request_with(
        Duration::ZERO,
        || {
            attempts += 1;
            assert!(attempts <= 3);
            let mut response = official_payload(if attempts == 2 { 403 } else { 401 }, 0);
            response.token_usage_account.as_mut().unwrap().account_id =
                if attempts == 2 { "backup" } else { "current" }.into();
            Ok(response)
        },
        |_, event| {
            switches += 1;
            let UpstreamQuotaEvent::Retry {
                exhausted_account_ids,
            } = event
            else {
                panic!("unexpected timeout")
            };
            assert_eq!(exhausted_account_ids.len(), switches);
            true
        },
        |_| panic!("no authentication backoff"),
    )
    .unwrap();
    assert_eq!((response.status, attempts, switches), (401, 3, 2));
}

#[test]
fn authentication_retry_does_not_rotate_provider_or_unrelated_http_failures() {
    for status in [400, 401, 403, 404, 500, 503] {
        for official in [false, true] {
            if official && matches!(status, 401 | 403) {
                continue;
            }
            let response = retry_upstream_request_with(
                Duration::ZERO,
                || {
                    let mut response = official_payload(status, 0);
                    if !official {
                        response.token_usage_account = None;
                    }
                    Ok(response)
                },
                |_, _| panic!("unrelated errors must not change official accounts"),
                |_| panic!("unrelated errors must not retry"),
            )
            .unwrap();
            assert_eq!(response.status, status);
        }
    }
}

#[test]
fn authentication_retry_can_leave_an_account_disabled_by_background_usage_refresh() {
    let mut current = account_with_usage("current", 50.0, 50.0);
    current.auto_switch_enabled = false;
    let failed = HashSet::from(["current".into()]);
    assert!(can_leave_failed_account(&current, "current", &failed));
    assert!(!can_leave_failed_account(
        &current,
        "current",
        &HashSet::new()
    ));
    assert!(!can_leave_failed_account(&current, "other", &failed));
    let accounts = vec![current, account_with_usage("backup", 80.0, 80.0)];
    assert_eq!(
        account_with_lowest_remaining_primary_quota(&accounts, "current", false, false, 0.0)
            .unwrap()
            .id,
        "backup"
    );
}

#[test]
fn authentication_retry_preserves_failed_refresh_account_and_rejects_transport_errors() {
    use crate::codex_api::TokenRefreshError;
    for status in [401, 403] {
        let account = official_payload(status, 7).token_usage_account.unwrap();
        let response = account_failure::CredentialError::Refresh {
            error: TokenRefreshError::Authentication {
                status,
                message: "expired login".into(),
            },
            account,
        }
        .into_response()
        .unwrap();
        assert_eq!(response.status, status);
        let account = response.token_usage_account.unwrap();
        assert_eq!(account.account_id, "current");
        assert_eq!(account.active_account_generation, 7);
        assert!(account.auto_switch_eligible);
    }
    let error = account_failure::CredentialError::Refresh {
        error: TokenRefreshError::Other("connection timed out".into()),
        account: official_payload(401, 0).token_usage_account.unwrap(),
    }
    .into_response();
    assert!(matches!(error, Err(message) if message == "connection timed out"));
}

#[test]
fn authentication_retry_classifies_real_official_http_responses() {
    for status in [401, 403] {
        let app = breakdown_responsiveness_test_app();
        let paths = resolve_paths(app.handle()).unwrap();
        let member = aggregate_official_account(&paths, "expired@example.test");
        let account_id = aggregate_api::member_account_id(&member).unwrap();
        let server = AggregateTestServer::status(status);
        let _upstream = AggregateOfficialUpstream::set(&server.url);
        let response = forward_official(OfficialForwardRequest {
            app: app.handle(),
            method: &Method::Post,
            url: "/v1/responses",
            headers: &[],
            body: br#"{"input":"hello"}"#.to_vec(),
            model: "test-model",
            session_id: None,
            account_id_override: Some(account_id),
        })
        .unwrap();
        assert!(account_failure::requires_account_failover(&response));
        assert_eq!(
            response.token_usage_account.as_ref().unwrap().account_id,
            account_id
        );
        assert!(!credential_can_trigger_auto_switch(
            response.token_usage_account.as_ref().unwrap()
        ));
        assert_eq!(server.calls(), 1);
    }
}
