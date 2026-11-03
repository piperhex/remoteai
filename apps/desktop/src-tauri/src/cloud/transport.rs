use super::*;

mod batch_sync;
pub(super) use batch_sync::{upload_sync_records, SyncRecords, SyncUpload};

pub(super) fn upsert_remote_account_payload<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    account: &CloudAccountPayload,
) -> Result<(), String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::PUT,
        &format!("/sync/accounts/{}", account.id),
        Some(serde_json::to_value(account).map_err(|error| error.to_string())?),
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud account upload", response));
    }
    Ok(())
}

pub(super) fn upsert_remote_provider_payload<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    provider: &ProviderSyncPayload,
) -> Result<(), String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::PUT,
        &format!("/sync/providers/{}", provider.id),
        Some(serde_json::to_value(provider).map_err(|error| error.to_string())?),
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud provider upload", response));
    }
    Ok(())
}

pub(super) fn put_remote_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    id: &str,
) -> Result<(), String> {
    let account = collect_local_account(app, id)?;
    upsert_remote_account_payload(app, client, settings, credentials, &account)?;
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(())
}

pub(super) struct RestoreRemoteAccountOptions<'a, R: Runtime> {
    pub(super) app: &'a tauri::AppHandle<R>,
    pub(super) client: &'a Client,
    pub(super) settings: &'a mut AppSettings,
    pub(super) credentials: &'a mut CloudCredentials,
    pub(super) id: &'a str,
}

pub(super) fn restore_remote_account_if_deleted<R: Runtime>(
    options: RestoreRemoteAccountOptions<'_, R>,
) -> Result<bool, String> {
    let RestoreRemoteAccountOptions {
        app,
        client,
        settings,
        credentials,
        id,
    } = options;
    let encoded_id = url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>();
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::POST,
        &format!("/admin/api/profile/accounts/deleted/{encoded_id}/restore"),
        None,
    )?;
    if let Some(restored) = restored_account_status(response.status()) {
        return Ok(restored);
    }
    Err(response_error("Cloud account restore", response))
}

pub(super) fn restored_account_status(status: StatusCode) -> Option<bool> {
    if status.is_success() {
        return Some(true);
    }
    (status == StatusCode::NOT_FOUND).then_some(false)
}

pub(super) fn put_remote_provider<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    id: &str,
) -> Result<(), String> {
    let provider = collect_local_provider(app, id)?;
    upsert_remote_provider_payload(app, client, settings, credentials, &provider)?;
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(())
}

pub(super) fn delete_remote_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    id: &str,
) -> Result<(), String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::DELETE,
        &format!("/sync/accounts/{id}"),
        None,
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud account delete", response));
    }
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(())
}

pub(super) fn delete_remote_provider<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    id: &str,
) -> Result<(), String> {
    let response = cloud_request(
        app,
        client,
        settings,
        credentials,
        Method::DELETE,
        &format!("/sync/providers/{id}"),
        None,
    )?;
    if !response.status().is_success() {
        return Err(response_error("Cloud provider delete", response));
    }
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    Ok(())
}
