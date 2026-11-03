use super::*;

pub(super) fn get_remote_totp_vault<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<CloudTotpVault, String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::GET,
        "/sync/totp",
        None,
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud 2FA download", response));
    }
    response
        .json()
        .map_err(|error| format!("Cloud 2FA response is invalid: {error}"))
}

pub(super) fn validate_totp_entry(entry: &CloudTotpEntry) -> Result<(), String> {
    let valid_secret = !entry.secret.is_empty()
        && entry
            .secret
            .chars()
            .all(|character| matches!(character, 'A'..='Z' | '2'..='7'));
    let valid_algorithm = matches!(entry.algorithm.as_str(), "SHA1" | "SHA256" | "SHA512");
    if Uuid::parse_str(&entry.id).is_err()
        || entry.issuer.len() > 160
        || entry.account_name.len() > 320
        || entry.secret.len() > 512
        || !valid_secret
        || !valid_algorithm
        || !matches!(entry.digits, 6 | 8)
        || !(15..=120).contains(&entry.period)
        || DateTime::parse_from_rfc3339(&entry.created_at).is_err()
        || entry
            .updated_at
            .as_deref()
            .is_some_and(|value| DateTime::parse_from_rfc3339(value).is_err())
    {
        return Err("A 2FA entry is invalid".to_string());
    }
    Ok(())
}

pub(super) fn validate_totp_tombstone(tombstone: &CloudTotpTombstone) -> Result<(), String> {
    if Uuid::parse_str(&tombstone.id).is_err()
        || DateTime::parse_from_rfc3339(&tombstone.deleted_at).is_err()
    {
        return Err("A 2FA deletion record is invalid".to_string());
    }
    Ok(())
}

pub(super) fn validate_totp_vault(
    entries: &[CloudTotpEntry],
    tombstones: &[CloudTotpTombstone],
    modified_at: &str,
) -> Result<(), String> {
    if entries.len() > 200
        || tombstones.len() > 200
        || DateTime::parse_from_rfc3339(modified_at).is_err()
    {
        return Err("The 2FA vault is invalid".to_string());
    }
    entries.iter().try_for_each(validate_totp_entry)?;
    tombstones.iter().try_for_each(validate_totp_tombstone)
}

pub(super) fn put_remote_totp_vault<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    vault: &CloudTotpVault,
) -> Result<CloudTotpVault, String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::PUT,
        "/sync/totp",
        Some(serde_json::to_value(vault).map_err(|error| error.to_string())?),
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud 2FA upload", response));
    }
    response
        .json()
        .map_err(|error| format!("Cloud 2FA response is invalid: {error}"))
}

pub(super) fn put_remote_accounts<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<usize, String> {
    let accounts = collect_local_accounts(app)?;
    let uploaded = upload_sync_records(
        SyncUpload {
            app,
            client,
            settings,
            credentials,
        },
        SyncRecords::Accounts(&accounts),
    )?;
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(uploaded)
}

pub(super) fn put_remote_providers<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<usize, String> {
    let providers = put_remote_provider_records(app, client, settings, credentials)?;
    let aggregates = aggregates::sync_aggregates(app, client, settings, credentials)
        .map_err(|error| error.to_string())?;
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(providers + aggregates)
}

pub(super) fn put_remote_provider_records<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<usize, String> {
    let providers = collect_local_providers(app)?;
    upload_sync_records(
        SyncUpload {
            app,
            client,
            settings,
            credentials,
        },
        SyncRecords::Providers(&providers),
    )
}

#[tauri::command]
pub(crate) async fn cloud_sync_totp<R: Runtime>(
    app: tauri::AppHandle<R>,
    entries: Vec<CloudTotpEntry>,
    tombstones: Vec<CloudTotpTombstone>,
    modified_at: String,
) -> Result<CloudTotpVault, String> {
    validate_totp_vault(&entries, &tombstones, &modified_at)?;
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let local = CloudTotpVault {
            entries,
            tombstones,
            modified_at: Some(modified_at),
        };
        let result = put_remote_totp_vault(&app, &client, &mut settings, &mut credentials, &local)?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(result)
    })
    .await
    .map_err(|error| format!("Cloud 2FA sync task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_pull_totp<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudTotpVault, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let result = get_remote_totp_vault(&app, &client, &mut settings, &mut credentials)?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(result)
    })
    .await
    .map_err(|error| format!("Cloud 2FA download task failed: {error}"))?
}
