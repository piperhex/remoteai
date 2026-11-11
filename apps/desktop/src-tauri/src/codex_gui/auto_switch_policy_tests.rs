use super::*;
use crate::{
    codex_gui::auto_switch_settings::GuiAutoSwitchAccount,
    models::{AccountPrivateDetails, UsageSummary, UsageWindow},
};

fn window(remaining: f64) -> UsageWindow {
    UsageWindow {
        used_percent: 100.0 - remaining,
        remaining_percent: remaining,
        resets_at: None,
        window_minutes: None,
    }
}

fn account(id: &str, remaining: f64) -> AccountSummary {
    AccountSummary {
        account_source: "codex",
        id: id.into(),
        email: format!("{id}@example.test"),
        group: String::new(),
        note: String::new(),
        expires_at: String::new(),
        private_details: AccountPrivateDetails::default(),
        plan: "plus".into(),
        account_id: None,
        active: false,
        auto_switch_enabled: false,
        auto_switch_priority: -99,
        auto_switch_threshold: 100.0,
        local_proxy_compatible: true,
        direct_switch_compatible: true,
        agent_identity: false,
        official: true,
        metadata_editable: true,
        usage: UsageSummary {
            primary: Some(window(remaining)),
            ..Default::default()
        },
    }
}

fn rule(id: &str, priority: i32, threshold: f64) -> GuiAutoSwitchAccount {
    GuiAutoSwitchAccount {
        account_id: id.into(),
        enabled: true,
        priority,
        threshold_percent: threshold,
    }
}

fn pool(ids: &[&str]) -> Vec<Candidate> {
    ids.iter()
        .map(|id| Candidate {
            id: (*id).into(),
            priority: 0,
            remaining: 50.0,
        })
        .collect()
}

#[test]
fn candidates_ignore_manager_flags_and_order_by_gui_priority_then_quota_then_id() {
    let mut shared_favorite = account("shared-favorite", 40.0);
    shared_favorite.auto_switch_enabled = true;
    shared_favorite.auto_switch_priority = -1_000;
    shared_favorite.auto_switch_threshold = 0.0;
    let accounts = vec![
        shared_favorite,
        account("b", 10.0),
        account("a", 10.0),
        account("gui-first", 90.0),
    ];
    let settings = GuiAutoSwitchSettings {
        accounts: vec![rule("gui-first", -1, 0.0)],
        ..Default::default()
    };
    let result = candidates(&accounts, &settings, &HashSet::new());
    assert_eq!(
        result
            .iter()
            .map(|value| value.id.as_str())
            .collect::<Vec<_>>(),
        vec!["gui-first", "a", "b", "shared-favorite"]
    );
    assert_eq!(result[1].priority, 0);
    assert_eq!(result[1].remaining, 10.0);
}

#[test]
fn candidates_respect_disabled_rules_exclusions_and_both_gui_thresholds() {
    let accounts = vec![
        account("disabled", 90.0),
        account("excluded", 90.0),
        account("global-low", 9.0),
        account("own-low", 19.0),
        account("at-limit", 20.0),
        account("default-rule", 10.0),
    ];
    let settings = GuiAutoSwitchSettings {
        minimum_remaining_percent: 10.0,
        accounts: vec![
            GuiAutoSwitchAccount {
                enabled: false,
                ..rule("disabled", 0, 0.0)
            },
            rule("own-low", 0, 20.0),
            rule("at-limit", 0, 20.0),
        ],
        ..Default::default()
    };
    let result = candidates(&accounts, &settings, &HashSet::from(["excluded".into()]));
    assert_eq!(
        result
            .iter()
            .map(|value| value.id.as_str())
            .collect::<Vec<_>>(),
        vec!["default-rule", "at-limit"]
    );
}

#[test]
fn candidates_require_usable_reported_windows() {
    let settings = GuiAutoSwitchSettings::default();
    for remaining in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut value = account("a", remaining);
        assert!(candidates(&[value], &settings, &HashSet::new()).is_empty());
        value = account("a", 90.0);
        value.usage.secondary = Some(window(remaining));
        assert!(candidates(&[value], &settings, &HashSet::new()).is_empty());
    }
    let mut missing_primary = account("missing", 90.0);
    missing_primary.usage.primary = None;
    let mut failed_refresh = account("failed", 90.0);
    failed_refresh.usage.error = Some("refresh failed".into());
    let mut incompatible = account("incompatible", 90.0);
    incompatible.local_proxy_compatible = false;
    assert!(candidates(
        &[missing_primary, failed_refresh, incompatible],
        &settings,
        &HashSet::new()
    )
    .is_empty());
    assert_eq!(
        candidates(&[account("a", 1.0)], &settings, &HashSet::new()).len(),
        1
    );
}

#[test]
fn current_switches_when_removed_disabled_or_incompatible() {
    let mut settings = GuiAutoSwitchSettings::default();
    assert!(current_requires_switch(None, &settings));
    let mut current = account("a", 50.0);
    assert!(!current_requires_switch(Some(&current), &settings));
    current.local_proxy_compatible = false;
    assert!(current_requires_switch(Some(&current), &settings));
    current.local_proxy_compatible = true;
    settings.accounts = vec![GuiAutoSwitchAccount {
        enabled: false,
        ..rule("a", 0, 0.0)
    }];
    assert!(current_requires_switch(Some(&current), &settings));
}

#[test]
fn current_does_not_switch_on_failed_or_missing_quota_information() {
    let settings = GuiAutoSwitchSettings {
        minimum_remaining_percent: 50.0,
        ..Default::default()
    };
    let mut current = account("a", 0.0);
    current.usage.error = Some("refresh failed".into());
    assert!(!current_requires_switch(Some(&current), &settings));
    current.usage.error = None;
    current.usage.primary = None;
    current.usage.secondary = Some(window(0.0));
    assert!(!current_requires_switch(Some(&current), &settings));
    current.usage.primary = Some(window(f64::NAN));
    current.usage.secondary = Some(window(f64::INFINITY));
    assert!(!current_requires_switch(Some(&current), &settings));
}

#[test]
fn current_uses_gui_thresholds_even_when_exhaustion_switching_is_off() {
    let mut settings = GuiAutoSwitchSettings {
        switch_on_quota_exhaustion: false,
        minimum_remaining_percent: 10.0,
        accounts: vec![rule("a", 0, 20.0)],
        ..Default::default()
    };
    let mut current = account("a", 19.0);
    assert!(current_requires_switch(Some(&current), &settings));
    current.usage.primary = Some(window(20.0));
    assert!(!current_requires_switch(Some(&current), &settings));
    settings.minimum_remaining_percent = 21.0;
    assert!(current_requires_switch(Some(&current), &settings));
}

#[test]
fn exhaustion_switching_respects_the_toggle_for_both_reported_windows() {
    let mut settings = GuiAutoSwitchSettings::default();
    let mut current = account("a", 0.0);
    assert!(current_requires_switch(Some(&current), &settings));
    settings.switch_on_quota_exhaustion = false;
    assert!(!current_requires_switch(Some(&current), &settings));
    current.usage.primary = Some(window(50.0));
    current.usage.secondary = Some(window(0.0));
    assert!(!current_requires_switch(Some(&current), &settings));
    settings.switch_on_quota_exhaustion = true;
    assert!(current_requires_switch(Some(&current), &settings));
}

#[test]
fn scheduler_balances_new_conversations_and_keeps_existing_assignments() {
    let mut scheduler = GuiAccountScheduler::default();
    let candidates = pool(&["a", "b"]);
    let now = Instant::now();
    assert_eq!(
        scheduler.assign(Some("first"), &candidates, now).as_deref(),
        Some("a")
    );
    assert_eq!(
        scheduler
            .assign(Some("second"), &candidates, now)
            .as_deref(),
        Some("b")
    );
    assert_eq!(
        scheduler.assign(Some("third"), &candidates, now).as_deref(),
        Some("a")
    );
    assert_eq!(
        scheduler
            .assign(Some("first"), &pool(&["b", "a"]), now)
            .as_deref(),
        Some("a")
    );
    assert_eq!(
        scheduler
            .assign(Some("fourth"), &candidates, now)
            .as_deref(),
        Some("b")
    );
    assert_eq!(scheduler.bindings.len(), 4);
}

#[test]
fn scheduler_balances_only_the_highest_priority_tier_for_new_conversations() {
    let mut scheduler = GuiAccountScheduler::default();
    let mut candidates = pool(&["a", "b", "backup"]);
    candidates[2].priority = 1;
    let now = Instant::now();
    for (session, expected) in [("first", "a"), ("second", "b"), ("third", "a")] {
        assert_eq!(
            scheduler.assign(Some(session), &candidates, now).as_deref(),
            Some(expected)
        );
    }
    candidates[2].priority = -1;
    assert_eq!(
        scheduler.assign(Some("first"), &candidates, now).as_deref(),
        Some("a")
    );
    for session in ["fourth", "fifth", "sixth"] {
        assert_eq!(
            scheduler.assign(Some(session), &candidates, now).as_deref(),
            Some("backup")
        );
    }
}

#[test]
fn scheduler_requests_without_a_session_do_not_affect_conversation_counts() {
    let mut scheduler = GuiAccountScheduler::default();
    let candidates = pool(&["a", "b"]);
    let now = Instant::now();
    for session in [None, Some(""), Some(" ")] {
        assert_eq!(
            scheduler.assign(session, &candidates, now).as_deref(),
            Some("a")
        );
    }
    assert!(scheduler.bindings.is_empty());
    assert_eq!(
        scheduler.assign(Some("first"), &candidates, now).as_deref(),
        Some("a")
    );
}

#[test]
fn scheduler_rebinds_when_an_account_becomes_ineligible_or_is_invalidated() {
    let mut scheduler = GuiAccountScheduler::default();
    let now = Instant::now();
    scheduler.assign(Some("first"), &pool(&["a", "b"]), now);
    assert_eq!(
        scheduler
            .assign(Some("first"), &pool(&["b"]), now)
            .as_deref(),
        Some("b")
    );
    scheduler.invalidate_account("b");
    assert!(scheduler.bindings.is_empty());
    assert_eq!(
        scheduler
            .assign(Some("first"), &pool(&["a", "b"]), now)
            .as_deref(),
        Some("a")
    );
    assert!(scheduler.assign(Some("first"), &[], now).is_none());
    assert!(scheduler.bindings.is_empty());
}

#[test]
fn scheduler_request_exclusions_preserve_other_conversations() {
    let mut scheduler = GuiAccountScheduler::default();
    let now = Instant::now();
    scheduler.assign(Some("healthy"), &pool(&["a", "b"]), now);
    scheduler.assign(Some("retrying"), &pool(&["a", "b"]), now);
    assert_eq!(
        scheduler
            .assign(Some("retrying"), &pool(&["b"]), now)
            .as_deref(),
        Some("b")
    );
    assert_eq!(scheduler.bindings.len(), 2);
    assert_eq!(scheduler.bindings["healthy"].account_id, "a");
    assert_eq!(
        scheduler
            .assign(Some("healthy"), &pool(&["b", "a"]), now)
            .as_deref(),
        Some("a")
    );
    assert_eq!(
        scheduler
            .assign(Some("retrying"), &pool(&["a"]), now)
            .as_deref(),
        Some("a")
    );
    assert_eq!(scheduler.bindings["healthy"].account_id, "a");
    assert_eq!(scheduler.bindings["retrying"].account_id, "a");
}

#[test]
fn scheduler_empty_candidate_request_removes_only_its_own_binding() {
    let mut scheduler = GuiAccountScheduler::default();
    let now = Instant::now();
    scheduler.assign(Some("healthy"), &pool(&["a", "b"]), now);
    scheduler.assign(Some("retrying"), &pool(&["a", "b"]), now);
    assert!(scheduler.assign(Some("retrying"), &[], now).is_none());
    assert!(!scheduler.bindings.contains_key("retrying"));
    assert_eq!(scheduler.bindings.len(), 1);
    assert_eq!(scheduler.bindings["healthy"].account_id, "a");
    assert!(scheduler.assign(None, &[], now).is_none());
    assert_eq!(scheduler.bindings.len(), 1);
    assert_eq!(
        scheduler
            .assign(Some("healthy"), &pool(&["b", "a"]), now)
            .as_deref(),
        Some("a")
    );
}

#[test]
fn scheduler_expires_idle_conversations_and_refreshes_active_bindings() {
    let mut scheduler = GuiAccountScheduler::default();
    let candidates = pool(&["a", "b"]);
    let now = Instant::now();
    scheduler.assign(Some("idle"), &candidates, now);
    scheduler.assign(Some("active"), &candidates, now);
    let later = now + BINDING_IDLE_TIMEOUT - Duration::from_secs(1);
    assert_eq!(
        scheduler
            .assign(Some("active"), &candidates, later)
            .as_deref(),
        Some("b")
    );
    let expires = now + BINDING_IDLE_TIMEOUT;
    assert_eq!(
        scheduler
            .assign(Some("new"), &candidates, expires)
            .as_deref(),
        Some("a")
    );
    assert!(!scheduler.bindings.contains_key("idle"));
    assert!(scheduler.bindings.contains_key("active"));
    assert_eq!(scheduler.bindings.len(), 2);
}

#[test]
fn scheduler_caps_bindings_and_evicts_the_oldest_conversation() {
    let mut scheduler = GuiAccountScheduler::default();
    let candidates = pool(&["a", "b"]);
    let now = Instant::now();
    for index in 0..MAX_BINDINGS {
        scheduler.bindings.insert(
            format!("session-{index:04}"),
            SessionBinding {
                account_id: "a".into(),
                last_used: now + Duration::from_millis(index as u64),
            },
        );
    }
    let later = now + Duration::from_secs(5);
    assert_eq!(
        scheduler.assign(Some("new"), &candidates, later).as_deref(),
        Some("b")
    );
    assert_eq!(scheduler.bindings.len(), MAX_BINDINGS);
    assert!(!scheduler.bindings.contains_key("session-0000"));
    assert!(scheduler.bindings.contains_key("session-0001"));
    assert!(scheduler.bindings.contains_key("new"));
}
