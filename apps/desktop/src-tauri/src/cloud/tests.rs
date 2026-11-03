use super::{
    cloud_state, persist_cloud_token_response, refresh_rejection_expires_cloud_session,
    restored_account_status, saved_cloud_login_service, should_apply_remote_field,
    validate_totp_vault, CloudAccountsResponse, CloudCredentials, CloudProvidersResponse,
    CloudTokenResponse, CloudTotpEntry, CloudTotpTombstone, CloudUserResponse,
    DeletedCloudProvidersResponse,
};
use crate::models::AppSettings;
use reqwest::StatusCode;

#[test]
fn announcement_response_preserves_dark_colors_across_ipc() {
    let value = serde_json::json!({
        "content": "Notice", "enabled": true,
        "textColor": "#008271", "backgroundColor": "#CEFDEE",
        "darkTextColor": "#ABCDEF", "darkBackgroundColor": "#123456"
    });
    let announcement: super::CloudAnnouncement = serde_json::from_value(value).unwrap();
    let serialized = serde_json::to_value(announcement).unwrap();
    assert_eq!(serialized["darkTextColor"], "#ABCDEF");
    assert_eq!(serialized["darkBackgroundColor"], "#123456");
}

#[test]
fn announcement_response_accepts_legacy_colors() {
    let value = serde_json::json!({
        "content": "Notice", "enabled": true,
        "textColor": "#008271", "backgroundColor": "#CEFDEE"
    });
    let announcement: super::CloudAnnouncement = serde_json::from_value(value).unwrap();
    assert!(announcement.dark_text_color.is_none());
    assert!(announcement.dark_background_color.is_none());
}

fn valid_totp_entry() -> CloudTotpEntry {
    CloudTotpEntry {
        id: "10000000-0000-4000-8000-000000000001".to_string(),
        issuer: "Example".to_string(),
        account_name: "person@example.com".to_string(),
        secret: "JBSWY3DPEHPK3PXP".to_string(),
        algorithm: "SHA1".to_string(),
        digits: 6,
        period: 30,
        created_at: "2026-08-15T10:00:00Z".to_string(),
        updated_at: Some("2026-08-15T10:00:00Z".to_string()),
    }
}

#[test]
fn totp_vault_validation_rejects_non_base32_secrets() {
    let mut entry = valid_totp_entry();
    entry.secret = "NOT-A-SECRET".to_string();

    assert!(validate_totp_vault(&[entry], &[], "2026-08-15T10:00:00Z").is_err());
}

#[test]
fn totp_vault_validation_rejects_invalid_tombstones() {
    let tombstone = CloudTotpTombstone {
        id: "not-a-uuid".to_string(),
        deleted_at: "2026-08-15T10:00:01Z".to_string(),
    };

    assert!(
        validate_totp_vault(&[valid_totp_entry()], &[tombstone], "2026-08-15T10:00:01Z",).is_err()
    );
}

#[test]
fn cloud_account_response_accepts_soft_delete_tombstones() {
    let response: CloudAccountsResponse =
        serde_json::from_str(r#"{"accounts":[],"deletedAccountIds":["account-1"]}"#).unwrap();

    assert!(response.accounts.is_empty());
    assert_eq!(response.deleted_account_ids, ["account-1"]);
}

#[test]
fn cloud_provider_response_accepts_soft_delete_tombstones() {
    let response: CloudProvidersResponse =
        serde_json::from_str(r#"{"providers":[],"deletedProviderIds":["provider-1"]}"#).unwrap();

    assert!(response.providers.is_empty());
    assert_eq!(response.deleted_provider_ids, ["provider-1"]);
}

#[test]
fn deleted_cloud_provider_response_accepts_safe_summary_fields() {
    let response: DeletedCloudProvidersResponse = serde_json::from_str(
        r#"{
                "providers": [{
                    "id": "provider-1",
                    "name": "Gateway",
                    "baseUrl": "https://example.com/v1",
                    "model": "gpt-5.6",
                    "deletedAt": "2026-08-15T01:00:00Z"
                }]
            }"#,
    )
    .unwrap();

    assert_eq!(response.providers.len(), 1);
    assert_eq!(response.providers[0].id, "provider-1");
    assert_eq!(response.providers[0].name, "Gateway");
}

#[test]
fn explicit_account_restore_continues_when_no_tombstone_exists() {
    assert_eq!(restored_account_status(StatusCode::OK), Some(true));
    assert_eq!(restored_account_status(StatusCode::NOT_FOUND), Some(false));
    assert_eq!(restored_account_status(StatusCode::FORBIDDEN), None);
}

#[test]
fn remote_fields_win_when_the_account_does_not_exist_locally() {
    assert!(should_apply_remote_field(
        false,
        "2026-07-26T04:00:00Z",
        "2026-07-25T04:00:00Z",
    ));
}

#[test]
fn existing_local_fields_still_use_last_write_wins() {
    assert!(!should_apply_remote_field(
        true,
        "2026-07-26T04:00:00Z",
        "2026-07-25T04:00:00Z",
    ));
    assert!(should_apply_remote_field(
        true,
        "2026-07-25T04:00:00Z",
        "2026-07-26T04:00:00Z",
    ));
}

#[test]
fn refreshed_credentials_are_persisted_before_followup_work() {
    let mut settings = AppSettings::default();
    let mut credentials = CloudCredentials {
        access_token: Some("old-access".to_string()),
        refresh_token: Some("old-refresh".to_string()),
        device_id: Some("device-1".to_string()),
        ..CloudCredentials::default()
    };
    let mut persisted_credentials = None;

    persist_cloud_token_response(
        &mut settings,
        &mut credentials,
        CloudTokenResponse {
            access_token: "new-access".to_string(),
            refresh_token: "new-refresh".to_string(),
            user: Some(CloudUserResponse {
                id: "user-1".to_string(),
                email: "user@example.com".to_string(),
            }),
        },
        |credentials| {
            persisted_credentials = Some(credentials.clone());
            Ok(())
        },
        |_| Ok(()),
    )
    .unwrap();

    let followup_result: Result<(), String> = Err("sync failed".to_string());
    assert!(followup_result.is_err());
    assert_eq!(
        persisted_credentials.unwrap().refresh_token.as_deref(),
        Some("new-refresh")
    );
}

#[test]
fn credential_rotation_is_saved_before_profile_settings() {
    let mut settings = AppSettings::default();
    let mut credentials = CloudCredentials::default();
    let mut credential_write_completed = false;

    let result = persist_cloud_token_response(
        &mut settings,
        &mut credentials,
        CloudTokenResponse {
            access_token: "new-access".to_string(),
            refresh_token: "new-refresh".to_string(),
            user: None,
        },
        |_| {
            credential_write_completed = true;
            Ok(())
        },
        |_| Err("settings write failed".to_string()),
    );

    assert_eq!(result.unwrap_err(), "settings write failed");
    assert!(credential_write_completed);
}

#[test]
fn saved_logins_are_isolated_by_cloud_server() {
    let first = AppSettings {
        cloud_base_url: Some("https://cloud-one.example".to_string()),
        ..AppSettings::default()
    };
    let second = AppSettings {
        cloud_base_url: Some("https://cloud-two.example".to_string()),
        ..AppSettings::default()
    };

    let first_service = saved_cloud_login_service(&first).unwrap();
    let second_service = saved_cloud_login_service(&second).unwrap();

    assert_ne!(first_service, second_service);
    assert!(first_service.starts_with("codex-switch-cloud-login-"));
    assert!(!first_service.contains("cloud-one.example"));
}

#[test]
fn rejected_refresh_marks_the_cloud_state_for_reauthentication() {
    assert!(refresh_rejection_expires_cloud_session(
        StatusCode::UNAUTHORIZED
    ));
    assert!(refresh_rejection_expires_cloud_session(
        StatusCode::FORBIDDEN
    ));
    assert!(!refresh_rejection_expires_cloud_session(
        StatusCode::SERVICE_UNAVAILABLE
    ));

    let settings = AppSettings {
        cloud_session_expired: true,
        ..AppSettings::default()
    };
    let state = cloud_state(&settings, &CloudCredentials::default());
    assert!(state.session_expired);
    assert!(!state.authenticated);
}
