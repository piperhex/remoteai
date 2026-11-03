//! Reserve authentication attempts and invalidate local identity before remote logout.
use super::*;

pub(super) fn begin_login<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(AppSettings, LoginTicket), String> {
    let _guard = lock_cloud_credentials()?;
    reserve_cloud_login(app)
}

pub(super) fn commit_login<R: Runtime>(
    app: &tauri::AppHandle<R>,
    expected: &LoginTicket,
    tokens: CloudTokenResponse,
) -> Result<(AppSettings, CloudCredentials), String> {
    with_cloud_data(app, || {
        let _guard = lock_cloud_credentials()?;
        let (mut settings, _) = current_cloud_login(app, expected)?;
        invalidate_cloud_session(app)?;
        let credentials = CloudCredentials {
            access_token: Some(tokens.access_token),
            refresh_token: Some(tokens.refresh_token),
            device_id: Some(read_or_create_installation_state(app)?.device_id),
            ..CloudCredentials::default()
        };
        if let Some(user) = tokens.user {
            settings.cloud_user_id = Some(user.id);
            settings.cloud_user_email = Some(user.email);
        }
        settings.cloud_session_expired = false;
        write_cloud_credentials(app, &credentials)?;
        if let Err(error) = write_app_settings(app, &settings) {
            // Never expose the new account's tokens paired with the previous owner.
            clear_cloud_credentials(app)?;
            return Err(error);
        }
        cloud_snapshot_locked(app)
    })
}

pub(super) fn logout_local<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(CloudAuthState, AppSettings, CloudCredentials), String> {
    with_cloud_data(app, || {
        let _guard = lock_cloud_credentials()?;
        let (mut settings, credentials) = cloud_snapshot_locked(app)?;
        invalidate_cloud_session(app)?;
        clear_cloud_profile(&mut settings);
        settings.cloud_session_expired = false;
        clear_cloud_credentials(app)?;
        write_app_settings(app, &settings)?;
        Ok((
            cloud_state(&settings, &CloudCredentials::default()),
            settings,
            credentials,
        ))
    })
}

/// Apply a response only while its original login still owns the local data commit.
pub(super) fn merge_login_data<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<Option<CloudSyncWarning>, String> {
    let remote = get_remote_accounts(app, client, settings, credentials)?;
    for id in &remote.deleted_account_ids {
        with_cloud_session(app, credentials, || apply_remote_account_deletion(app, id))?;
    }
    for account in remote.accounts {
        with_cloud_session(app, credentials, || apply_remote_account(app, &account))?;
    }
    let remote = get_remote_providers(app, client, settings, credentials)?;
    for id in &remote.deleted_provider_ids {
        with_cloud_session(app, credentials, || apply_remote_provider_deletion(app, id))?;
    }
    for provider in remote.providers {
        with_cloud_session(app, credentials, || apply_remote_provider(app, &provider))?;
    }
    put_remote_accounts(app, client, settings, credentials)?;
    put_remote_provider_records(app, client, settings, credentials)?;
    aggregates::authentication_warning(aggregates::sync_aggregates(
        app,
        client,
        settings,
        credentials,
    ))
}
