use super::*;

#[test]
fn source_disabled_expired_and_incompatible_accounts_are_skipped() {
    let mut account = AccountSummary {
        account_source: "codex",
        id: "other".into(),
        email: String::new(),
        group: String::new(),
        note: String::new(),
        expires_at: String::new(),
        private_details: Default::default(),
        plan: String::new(),
        account_id: None,
        active: false,
        auto_switch_enabled: true,
        auto_switch_priority: 0,
        auto_switch_threshold: 0.0,
        local_proxy_compatible: true,
        direct_switch_compatible: true,
        agent_identity: false,
        official: false,
        metadata_editable: true,
        usage: Default::default(),
    };
    assert!(eligible_account(&account, "source"));
    assert!(!eligible_account(&account, "other"));
    account.auto_switch_enabled = false;
    assert!(!eligible_account(&account, "source"));
    account.auto_switch_enabled = true;
    account.expires_at = "1970-01-01".into();
    assert!(!eligible_account(&account, "source"));
    account.expires_at = "9999-12-31".into();
    assert!(eligible_account(&account, "source"));
    account.local_proxy_compatible = false;
    assert!(!eligible_account(&account, "source"));
}

#[test]
fn persisted_attempt_survives_restart_and_expires_after_the_window() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    let paths = Paths {
        codex_home: root.into(),
        current_auth: root.join("auth.json"),
        current_config: root.join("config.toml"),
        accounts: root.join("accounts"),
        providers: root.join("providers"),
        config_backup: root.join("backup.toml"),
        state_file: root.join("state.json"),
    };
    let now = 1_790_000_000;
    assert!(!attempt_pending(&paths, "idle", now).unwrap());
    let marker = storage::account_dir(&paths, "idle").join(ATTEMPT_FILE);
    storage::write_json_atomic(
        &marker,
        &serde_json::json!({"notBefore": now + WINDOW_SECONDS}),
    )
    .unwrap();
    assert!(attempt_pending(&paths, "idle", now).unwrap());
    assert!(attempt_pending(&paths.clone(), "idle", now + 1).unwrap());
    assert!(!attempt_pending(&paths, "idle", now + WINDOW_SECONDS).unwrap());
    storage::write_json_atomic(&marker, &serde_json::json!({})).unwrap();
    assert!(attempt_pending(&paths, "idle", now).is_err());
}

fn quota_response(at: i64, reset: i64, used: f64) -> crate::models::UsageSummary {
    let mut usage = crate::codex_api::parse_usage(&serde_json::json!({
        "rate_limit": {
            "primary_window": {
                "used_percent": used,
                "limit_window_seconds": 18000,
                "reset_at": reset
            }
        }
    }));
    usage.fetched_at = Some(
        chrono::DateTime::from_timestamp(at, 0)
            .unwrap()
            .to_rfc3339(),
    );
    usage
}

#[test]
fn live_quota_probe_confirms_sliding_placeholder_but_skips_fixed_rounded_zero() {
    let now = 1_790_000_000;
    for (drift, expected) in [(3, true), (0, false), (1, false)] {
        let mut responses = [
            Ok(quota_response(now, now + WINDOW_SECONDS, 0.0)),
            Ok(quota_response(now + 3, now + WINDOW_SECONDS + drift, 0.0)),
        ]
        .into_iter();
        let waited = std::cell::Cell::new(false);
        let reads = std::cell::Cell::new(0);
        let result = confirm_idle_window(
            || {
                if reads.get() == 1 {
                    assert!(waited.get());
                }
                reads.set(reads.get() + 1);
                responses.next().unwrap()
            },
            || waited.set(true),
            || now,
        )
        .unwrap();
        assert_eq!(result, expected);
        assert_eq!(reads.get(), 2);
    }
}

#[test]
fn probe_fails_closed_on_errors_or_new_usage_without_retrying() {
    let now = 1_790_000_000;
    for second in [
        Err("network failure".to_string()),
        Ok(quota_response(now + 3, now + WINDOW_SECONDS + 3, 1.0)),
        Ok(crate::models::UsageSummary::default()),
    ] {
        let mut responses =
            [Ok(quota_response(now, now + WINDOW_SECONDS, 0.0)), second].into_iter();
        let result = confirm_idle_window(|| responses.next().unwrap(), || {}, || now);
        assert!(!result.unwrap_or(false));
        assert!(responses.next().is_none());
    }
}

#[test]
fn unambiguous_idle_and_running_quotas_need_only_one_read() {
    let now = 1_790_000_000;
    for (used, reset, expected) in [
        (0.0, now - 1, true),
        (0.0, now + 600, false),
        (1.0, now + WINDOW_SECONDS, false),
    ] {
        let reads = std::cell::Cell::new(0);
        assert_eq!(
            confirm_idle_window(
                || {
                    reads.set(reads.get() + 1);
                    Ok(quota_response(now, reset, used))
                },
                || panic!("An unambiguous window must not need a confirmation read"),
                || now,
            )
            .unwrap(),
            expected
        );
        assert_eq!(reads.get(), 1);
    }
}
