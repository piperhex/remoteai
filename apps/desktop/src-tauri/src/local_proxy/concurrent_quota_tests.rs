use super::*;
use crate::local_proxy::{
    concurrent_account_for_session, retry_upstream_request_with, TokenUsageAccount, UpstreamBody,
};
use crate::models::{ManagerStateFile, UsageWindow};
use crate::storage::{managed_auth_path, save_usage, usage_path, Paths};
use std::{fs, path::PathBuf, time::Duration};

#[test]
fn concurrent_authentication_retry_excludes_failed_accounts_until_a_fresh_usage_success() {
    for status in [401, 403] {
        let fixture = RoutingFixture::new();
        let mut failed = quota_response(&fixture.account_ids[0]);
        failed.status = status;
        assert!(exclude_response(&failed).unwrap());
        assert_eq!(fixture.select(None).unwrap(), fixture.account_ids[1]);
        record_usage_refresh(
            &fixture.account_ids[0],
            Instant::now(),
            &remaining_usage(50.0),
        )
        .unwrap();
        let mut eligible = fixture.account_ids.to_vec();
        retain_available(&mut eligible).unwrap();
        assert_eq!(eligible, fixture.account_ids);
    }
}

fn remaining_usage(remaining: f64) -> UsageSummary {
    UsageSummary {
        primary: Some(UsageWindow {
            used_percent: 100.0 - remaining,
            remaining_percent: remaining,
            resets_at: None,
            window_minutes: None,
        }),
        ..UsageSummary::default()
    }
}

fn quota_response(account_id: &str) -> UpstreamPayload {
    UpstreamPayload {
        status: 429,
        content_type: None,
        response_headers: Vec::new(),
        body: UpstreamBody::Buffered(br#"{"error":{"type":"usage_limit_reached"}}"#.to_vec()),
        token_usage_service_tier: None,
        token_usage_account: Some(TokenUsageAccount {
            account_id: account_id.to_string(),
            account_email: String::new(),
            active_account_generation: 0,
            auto_switch_attempt_generation: 0,
            auto_switch_eligible: false,
            concurrent_request_started_at: Some(Instant::now()),
        }),
    }
}

struct RoutingFixture {
    root: PathBuf,
    paths: Paths,
    state: ManagerStateFile,
    account_ids: [String; 2],
}

impl RoutingFixture {
    fn new() -> Self {
        let id = uuid::Uuid::new_v4();
        let root = std::env::temp_dir().join(format!("codex-switch-concurrent-quota-{id}"));
        let paths = Paths {
            current_auth: root.join("codex/auth.json"),
            current_config: root.join("codex/config.toml"),
            codex_home: root.join("codex"),
            accounts: root.join("accounts"),
            providers: root.join("providers"),
            config_backup: root.join("config-backup.toml"),
            state_file: root.join("state.json"),
        };
        let account_ids = [format!("a-{id}"), format!("b-{id}")];
        for account_id in &account_ids {
            fs::create_dir_all(paths.accounts.join(account_id)).unwrap();
            fs::write(managed_auth_path(&paths, account_id), b"{}").unwrap();
            save_usage(&usage_path(&paths, account_id), &remaining_usage(50.0)).unwrap();
        }
        Self {
            root,
            paths,
            account_ids,
            state: ManagerStateFile {
                concurrent_account_routing_enabled: true,
                ..ManagerStateFile::default()
            },
        }
    }

    fn select(&self, session: Option<&str>) -> Result<String, String> {
        concurrent_account_for_session(&self.paths, &self.state, session)
            .map(|account| account.unwrap())
    }
}

impl Drop for RoutingFixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn confirmed_quota_failure_reassigns_the_session_before_any_backoff() {
    let fixture = RoutingFixture::new();
    let session = format!("session-{}", fixture.account_ids[0]);
    let mut attempts = Vec::new();
    let response = retry_upstream_request_with(
        Duration::ZERO,
        || {
            let account_id = fixture.select(Some(&session))?;
            attempts.push(account_id.clone());
            let mut response = quota_response(&account_id);
            if account_id == fixture.account_ids[1] {
                response.status = 200;
            }
            Ok(response)
        },
        |_, _| panic!("Concurrent exhaustion must not switch the global account"),
        |_| panic!("Confirmed exhaustion must not wait for ordinary 429 backoff"),
    )
    .unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(attempts, fixture.account_ids);
    assert_eq!(
        fixture.select(Some(&session)).unwrap(),
        fixture.account_ids[1]
    );
    assert_eq!(fixture.select(None).unwrap(), fixture.account_ids[1]);
    let new_session = format!("new-{session}");
    assert_eq!(
        fixture.select(Some(&new_session)).unwrap(),
        fixture.account_ids[1]
    );
}

#[test]
fn all_exhausted_accounts_fail_without_revisiting_cached_positive_usage() {
    let fixture = RoutingFixture::new();
    let mut attempts = Vec::new();
    let result = retry_upstream_request_with(
        Duration::from_secs(10),
        || {
            let account_id = fixture.select(None)?;
            attempts.push(account_id.clone());
            Ok(quota_response(&account_id))
        },
        |_, _| panic!("Unexpected global switch"),
        |_| panic!("Unexpected backoff"),
    );
    assert!(result.is_err());
    assert_eq!(attempts, fixture.account_ids);
}

#[test]
fn ordinary_rate_limits_and_nonconcurrent_credentials_are_not_excluded() {
    let id = uuid::Uuid::new_v4().to_string();
    let mut response = quota_response(&id);
    response.body = UpstreamBody::Buffered(br#"{"error":{"type":"tokens"}}"#.to_vec());
    assert!(!exclude_response(&response).unwrap());
    response.body = UpstreamBody::Buffered(br#"{"error":{"type":"usage_limit_reached"}}"#.to_vec());
    response.status = 400;
    assert!(!exclude_response(&response).unwrap());
    response.status = 429;
    response
        .token_usage_account
        .as_mut()
        .unwrap()
        .concurrent_request_started_at = None;
    for status in [401, 403, 429] {
        response.status = status;
        assert!(!exclude_response(&response).unwrap());
    }
    response.token_usage_account = None;
    assert!(!exclude_response(&response).unwrap());
    assert!(quota_state().unwrap().is_available(&id));
}

#[test]
fn official_header_also_excludes_the_concurrent_account() {
    let id = uuid::Uuid::new_v4().to_string();
    let mut response = quota_response(&id);
    response.body = UpstreamBody::Buffered(Vec::new());
    response.response_headers.push((
        "x-codex-rate-limit-reached-type".to_string(),
        "workspace_member_usage_limit_reached".to_string(),
    ));
    assert!(exclude_response(&response).unwrap());
    assert!(!quota_state().unwrap().is_available(&id));
}

#[test]
fn recovery_requires_a_new_query_with_confirmed_remaining_quota() {
    let mut state = ConcurrentQuotaState::default();
    let started_at = Instant::now();
    let observed_at = started_at + Duration::from_secs(1);
    let refreshed_at = observed_at + Duration::from_secs(1);
    state.exclude("account", started_at, observed_at);
    state.recover("account", started_at, &remaining_usage(50.0));
    assert!(!state.is_available("account"));
    let mut failed = remaining_usage(50.0);
    failed.error = Some("Network error".to_string());
    let mut exhausted_secondary = remaining_usage(50.0);
    exhausted_secondary.secondary = remaining_usage(0.0).primary;
    for usage in [
        UsageSummary::default(),
        remaining_usage(0.0),
        failed,
        exhausted_secondary,
    ] {
        state.recover("account", refreshed_at, &usage);
        assert!(!state.is_available("account"));
    }
    state.recover("account", refreshed_at, &remaining_usage(50.0));
    assert!(state.is_available("account"));
    state.exclude("account", started_at, refreshed_at + Duration::from_secs(1));
    assert!(
        state.is_available("account"),
        "Delayed old failures must not undo recovery"
    );
    state.exclude(
        "account",
        refreshed_at,
        refreshed_at + Duration::from_secs(1),
    );
    assert!(
        !state.is_available("account"),
        "A new failure must exclude the account again"
    );
}

#[test]
fn simultaneous_failures_share_exclusion_and_leave_healthy_accounts_available() {
    let fixture = RoutingFixture::new();
    std::thread::scope(|scope| {
        for _ in 0..8 {
            let fixture = &fixture;
            scope.spawn(move || {
                assert!(exclude_response(&quota_response(&fixture.account_ids[0])).unwrap());
                assert_eq!(fixture.select(None).unwrap(), fixture.account_ids[1]);
            });
        }
    });
    record_usage_refresh(
        &fixture.account_ids[0],
        Instant::now(),
        &remaining_usage(50.0),
    )
    .unwrap();
    assert_eq!(fixture.select(None).unwrap(), fixture.account_ids[0]);
}
