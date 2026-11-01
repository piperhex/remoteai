use super::{policy::*, *};
use crate::models::{AppSettings, UsageWindow};

const NOW: i64 = 1_790_000_000;

fn usage(used: f64, reset: Option<i64>) -> UsageSummary {
    UsageSummary {
        primary: Some(UsageWindow {
            used_percent: used,
            remaining_percent: 100.0 - used,
            resets_at: reset,
            window_minutes: Some(WINDOW_MINUTES),
        }),
        fetched_at: Some(
            chrono::DateTime::from_timestamp(NOW, 0)
                .unwrap()
                .to_rfc3339(),
        ),
        ..UsageSummary::default()
    }
}

#[test]
fn idle_windows_can_start_but_running_windows_and_unknown_quotas_cannot() {
    assert!(can_start_window(&usage(0.0, None), NOW));
    assert!(can_start_window(&usage(0.0, Some(NOW)), NOW));
    assert!(!can_start_window(&usage(0.0, Some(NOW + 1)), NOW));
    assert!(!can_start_window(
        &usage(1.0, Some(NOW + WINDOW_SECONDS)),
        NOW
    ));
    assert!(!can_start_window(&usage(100.0, Some(NOW - 1)), NOW));
    assert!(!can_start_window(&UsageSummary::default(), NOW));
    let mut invalid = usage(0.0, None);
    invalid.error = Some("refresh failed".into());
    assert!(!can_start_window(&invalid, NOW));
    invalid.error = None;
    invalid.primary.as_mut().unwrap().window_minutes = Some(10_080);
    assert!(!can_start_window(&invalid, NOW));
}

#[test]
fn exhausted_weekly_quota_is_not_spent_and_secondary_five_hour_windows_are_supported() {
    let mut current = usage(0.0, None);
    current.secondary = usage(100.0, Some(NOW + WINDOW_SECONDS)).primary;
    current.secondary.as_mut().unwrap().window_minutes = Some(10_080);
    assert!(!can_start_window(&current, NOW));
    current.secondary.as_mut().unwrap().resets_at = Some(NOW - 1);
    assert!(can_start_window(&current, NOW));
    std::mem::swap(&mut current.primary, &mut current.secondary);
    assert!(can_start_window(&current, NOW));
    current.primary.as_mut().unwrap().remaining_percent = f64::NAN;
    assert!(!can_start_window(&current, NOW));
}

#[test]
fn actual_usage_changes_trigger_sync_without_replaying_refreshes_or_cache_imports() {
    let idle = usage(0.0, None);
    let started = usage(1.0, Some(NOW + WINDOW_SECONDS));
    assert!(usage_increased(&idle, &started, NOW));
    // A freshly reported full five hours can also be an unused account's placeholder.
    assert!(!usage_increased(
        &idle,
        &usage(0.0, Some(NOW + WINDOW_SECONDS)),
        NOW
    ));
    assert!(!usage_increased(&started, &started, NOW));
    assert!(!usage_increased(&UsageSummary::default(), &started, NOW));
    assert!(!usage_increased(&started, &idle, NOW));
    assert!(usage_increased(
        &started,
        &usage(2.0, started.primary.as_ref().unwrap().resets_at),
        NOW
    ));
    assert!(usage_increased(
        &started,
        &usage(0.5, Some(NOW + WINDOW_SECONDS + 1)),
        NOW
    ));
    let mut failed = started.clone();
    failed.error = Some("invalid quota".into());
    assert!(!usage_increased(&idle, &failed, NOW));
}

#[test]
fn moving_idle_deadlines_are_not_activity_or_proof_of_a_running_window() {
    let first = usage(0.0, Some(NOW + WINDOW_SECONDS));
    let mut second = usage(0.0, Some(NOW + WINDOW_SECONDS + 185));
    second.fetched_at = Some(
        chrono::DateTime::from_timestamp(NOW + 185, 0)
            .unwrap()
            .to_rfc3339(),
    );
    // This reproduces the screenshots: both show 100%, while each refresh moves reset_at.
    assert!(!can_start_window(&second, NOW + 185));
    assert!(sliding_idle_confirmed(&first, &second));
    assert!(!usage_increased(&first, &second, NOW + 185));
    std::mem::swap(&mut second.primary, &mut second.secondary);
    assert!(sliding_idle_confirmed(&first, &second));
}

#[test]
fn rounded_zero_running_deadlines_are_fixed_and_never_authorize_another_charge() {
    let first = usage(0.0, Some(NOW + WINDOW_SECONDS));
    let mut fixed = first.clone();
    fixed.fetched_at = Some(
        chrono::DateTime::from_timestamp(NOW + 5, 0)
            .unwrap()
            .to_rfc3339(),
    );
    assert!(!sliding_idle_confirmed(&first, &fixed));
    assert!(!can_start_window(&fixed, NOW + 5));
    assert!(usage_increased(&first, &fixed, NOW + 5));
    assert!(!usage_increased(&fixed, &fixed, NOW + 5));
}

#[test]
fn sliding_confirmation_rejects_short_probes_invalid_snapshots_and_exhaustion() {
    let first = usage(0.0, Some(NOW + WINDOW_SECONDS));
    let mut second = first.clone();
    let advance = |sample: &mut UsageSummary, seconds| {
        sample.fetched_at = Some(
            chrono::DateTime::from_timestamp(NOW + seconds, 0)
                .unwrap()
                .to_rfc3339(),
        );
        sample.primary.as_mut().unwrap().resets_at = Some(NOW + WINDOW_SECONDS + seconds);
    };
    advance(&mut second, 1);
    assert!(!sliding_idle_confirmed(&first, &second));
    advance(&mut second, 5);
    assert!(sliding_idle_confirmed(&first, &second));
    second.primary.as_mut().unwrap().used_percent = 0.01;
    assert!(!sliding_idle_confirmed(&first, &second));
    second.primary.as_mut().unwrap().used_percent = 0.0;
    second.error = Some("network failure".into());
    assert!(!sliding_idle_confirmed(&first, &second));
    second.error = None;
    second.secondary = usage(100.0, Some(NOW + WINDOW_SECONDS)).primary;
    second.secondary.as_mut().unwrap().window_minutes = Some(10_080);
    assert!(!sliding_idle_confirmed(&first, &second));
    assert!(!usage_increased(&first, &second, NOW + 5));
    second.secondary = None;
    second.fetched_at = Some("invalid date".into());
    assert!(!sliding_idle_confirmed(&first, &second));
    second.fetched_at = first.fetched_at.clone();
    second.primary.as_mut().unwrap().resets_at = Some(i64::MIN);
    assert!(!needs_idle_confirmation(&second));
}

#[test]
fn sweep_is_single_flight_and_throttled_until_the_next_activity() {
    let mut state = SweepState::new();
    let now = Instant::now();
    assert!(state.begin(now));
    assert!(!state.begin(now + CHECK_INTERVAL));
    state.running = false;
    assert!(!state.begin(now + CHECK_INTERVAL / 2));
    assert!(state.begin(now + CHECK_INTERVAL));
}

#[test]
fn old_settings_default_to_disabled_and_explicit_opt_in_round_trips() {
    let defaults: AppSettings = serde_json::from_str("{}").unwrap();
    assert!(!defaults.quota_window_sync_enabled);
    let enabled: AppSettings = serde_json::from_str(r#"{"quotaWindowSyncEnabled":true}"#).unwrap();
    assert!(enabled.quota_window_sync_enabled);
    assert_eq!(
        serde_json::to_value(enabled).unwrap()["quotaWindowSyncEnabled"],
        true
    );
}
