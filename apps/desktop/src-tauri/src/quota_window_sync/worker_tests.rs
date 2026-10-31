use super::*;

#[test]
fn source_disabled_expired_and_incompatible_accounts_are_skipped() {
    let mut account = AccountSummary {
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
