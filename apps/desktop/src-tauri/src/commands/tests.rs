#[cfg(test)]
mod account_switch_reason_tests {
    use super::AccountSwitchReason;

    #[test]
    fn only_manual_switches_disable_concurrent_routing() {
        assert!(AccountSwitchReason::Manual.disables_concurrent_routing());
        assert!(!AccountSwitchReason::Automatic.disables_concurrent_routing());
        assert!(!AccountSwitchReason::CredentialRefresh.disables_concurrent_routing());
    }

    #[test]
    fn actual_account_switches_refresh_the_official_model_catalog() {
        assert!(AccountSwitchReason::Manual.refreshes_official_model_catalog());
        assert!(AccountSwitchReason::Automatic.refreshes_official_model_catalog());
        assert!(!AccountSwitchReason::CredentialRefresh.refreshes_official_model_catalog());
    }

    #[test]
    fn credential_refreshes_do_not_import_sidebar_membership() {
        assert!(AccountSwitchReason::Manual.syncs_sidebar_membership());
        assert!(AccountSwitchReason::Automatic.syncs_sidebar_membership());
        assert!(!AccountSwitchReason::CredentialRefresh.syncs_sidebar_membership());
    }
}

#[cfg(test)]
mod compatible_json_import_tests {
    use super::{
        compatible_json_account_metadata, ensure_account_switch_allowed, is_sub2api_export,
        is_usage_network_error, normalize_compatible_json_auth, normalize_sub2api_auth,
        parse_compatible_json_auth_values, parse_sub2api_auth_values,
        restore_conversation_metadata_if_present, should_disable_account_auto_switch,
        sync_conversation_metadata_if_present_with_progress, sync_current_auth_with_client_state,
        update_disabled_account_ids, write_managed_auth_to_current, RequestAuth,
        LOCAL_PROXY_CONVERSATION_PROVIDER, OFFICIAL_CONVERSATION_PROVIDER,
    };
    use crate::models::{AccountPrivateDetails, ManagerStateFile};
    use crate::storage::{managed_auth_path, read_json, write_json_atomic, Paths};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use rusqlite::Connection;
    use serde_json::{json, Value};
    use std::{fs, path::PathBuf, time::SystemTime};

    #[test]
    fn private_account_details_normalize_phone_and_base32_key() {
        let details = AccountPrivateDetails {
            alias: None,
            password: "kept exactly ".to_string(),
            phone_number: "  +65 6123 4567  ".to_string(),
            totp_secret: "jbsw-y3dp ehpk3pxp==".to_string(),
        }
        .normalized()
        .expect("valid private details");
        assert_eq!(details.password, "kept exactly ");
        assert_eq!(details.phone_number, "+65 6123 4567");
        assert_eq!(details.totp_secret, "JBSWY3DPEHPK3PXP");
    }

    #[test]
    fn private_account_details_reject_invalid_2fa_keys() {
        let error = AccountPrivateDetails {
            totp_secret: "not-a-base32-key!".to_string(),
            ..Default::default()
        }
        .normalized()
        .expect_err("invalid key");
        assert_eq!(error, "2FA key must be a valid Base32 value");
    }

    fn jwt(payload: Value) -> String {
        format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).expect("serialize JWT payload"))
        )
    }

    fn access_token() -> String {
        jwt(json!({
            "email": "compatible@example.com",
            "sub": "compatible-user",
            "https://api.openai.com/auth": {
                "chatgpt_plan_type": "plus",
                "chatgpt_account_id": "compatible-account"
            }
        }))
    }

    fn agent_identity_auth() -> Value {
        json!({
            "auth_mode": "agentIdentity",
            "agent_identity": {
                "agent_runtime_id": "agent-runtime",
                "agent_private_key": base64::engine::general_purpose::STANDARD.encode([7_u8; 48]),
                "account_id": "agent-workspace",
                "chatgpt_user_id": "agent-user",
                "email": "agent@example.com",
                "plan_type": "business"
            }
        })
    }

    fn test_paths() -> Paths {
        let root = std::env::temp_dir().join(format!(
            "codex-switch-auth-sync-test-{}",
            uuid::Uuid::new_v4()
        ));
        let codex_home = root.join("codex-home");
        let app_data = root.join("app-data");
        Paths {
            current_auth: codex_home.join("auth.json"),
            current_config: codex_home.join("config.toml"),
            codex_home,
            accounts: app_data.join("accounts"),
            providers: app_data.join("providers"),
            config_backup: app_data.join("config-before-provider.toml"),
            state_file: app_data.join("state.json"),
        }
    }

    include!("compatible_import_tests.rs");
    include!("direct_account_auth_tests.rs");
    include!("account_usage_tests.rs");
    include!("conversation_sync_tests.rs");
    include!("conversation_sync_paginated_tests.rs");
}
