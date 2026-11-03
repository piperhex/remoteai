use super::*;

#[tauri::command]
pub(crate) async fn cloud_push_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let uploaded = put_remote_accounts(&app, &client, &mut settings, &mut credentials)?
            + put_remote_providers(&app, &client, &mut settings, &mut credentials)?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(CloudSyncResult {
            uploaded,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud upload task failed: {error}"))?
}

pub(super) fn pull_remote_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    id: &str,
) -> Result<CloudSyncResult, String> {
    let remote = get_remote_accounts(app, client, settings, credentials)?;
    let deleted = remote
        .deleted_account_ids
        .iter()
        .any(|account_id| account_id == id);
    let changed = if deleted {
        with_cloud_session(app, credentials, || apply_remote_account_deletion(app, id))?
    } else if let Some(account) = remote.accounts.into_iter().find(|account| account.id == id) {
        with_cloud_session(app, credentials, || apply_remote_account(app, &account))?
    } else {
        false
    };
    settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
    if changed {
        app.emit("accounts-changed", ())
            .map_err(|error| error.to_string())?;
        crate::system_tray::refresh_menu(app);
    }
    Ok(CloudSyncResult {
        uploaded: 0,
        downloaded: usize::from(changed),
    })
}

#[tauri::command]
pub(crate) async fn cloud_pull_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let result = pull_remote_account(&app, &client, &mut settings, &mut credentials, &id)?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(result)
    })
    .await
    .map_err(|error| format!("Cloud account download task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_push_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    restore_deleted: bool,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        if restore_deleted {
            restore_remote_account_if_deleted(RestoreRemoteAccountOptions {
                app: &app,
                client: &client,
                settings: &mut settings,
                credentials: &mut credentials,
                id: &id,
            })?;
        }
        put_remote_account(&app, &client, &mut settings, &mut credentials, &id)?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(CloudSyncResult {
            uploaded: 1,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud account upload task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_push_providers<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let uploaded = put_remote_providers(&app, &client, &mut settings, &mut credentials)?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(CloudSyncResult {
            uploaded,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud provider upload task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_push_provider<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    identity: Option<GuiCloudIdentity>,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        if let Some(identity) = identity {
            if base_url(&settings).ok() != Some(identity.base_url.as_str())
                || settings.cloud_user_id.as_deref() != Some(&identity.user_id)
                || !cloud_state(&settings, &credentials).authenticated
            {
                return Err("market.signIn".into());
            }
        }
        put_remote_provider(&app, &client, &mut settings, &mut credentials, &id)?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(CloudSyncResult {
            uploaded: 1,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud provider upload task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_delete_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        delete_remote_account(&app, &client, &mut settings, &mut credentials, &id)?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(CloudSyncResult {
            uploaded: 0,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud account delete task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_list_deleted_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<DeletedCloudAccount>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let response = cloud_request(
            &app,
            &client,
            &mut settings,
            &mut credentials,
            Method::GET,
            "/admin/api/profile/accounts/deleted",
            None,
        )?;
        if !response.status().is_success() {
            return Err(response_error("Cloud recycle bin download", response));
        }
        let payload: DeletedCloudAccountsResponse = response
            .json()
            .map_err(|error| format!("Cloud recycle bin response is invalid: {error}"))?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(payload.accounts)
    })
    .await
    .map_err(|error| format!("Cloud recycle bin task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_restore_deleted_account<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let restored = restore_remote_account_if_deleted(RestoreRemoteAccountOptions {
            app: &app,
            client: &client,
            settings: &mut settings,
            credentials: &mut credentials,
            id: &id,
        })?;
        if !restored {
            return Err("The deleted cloud account no longer exists".to_string());
        }
        let remote_accounts = get_remote_accounts(&app, &client, &mut settings, &mut credentials)?;
        let account = remote_accounts
            .accounts
            .into_iter()
            .find(|account| account.id == id)
            .ok_or_else(|| "The restored account is not available for download".to_string())?;
        with_cloud_session(&app, &credentials, || apply_remote_account(&app, &account))?;
        settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
        persist_cloud_sync(&app, &settings, &credentials)?;
        app.emit("accounts-changed", ())
            .map_err(|error| error.to_string())?;
        crate::system_tray::refresh_menu(&app);
        Ok(CloudSyncResult {
            uploaded: 0,
            downloaded: 1,
        })
    })
    .await
    .map_err(|error| format!("Cloud account restore task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_list_deleted_providers<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<DeletedCloudProvider>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let response = cloud_request(
            &app,
            &client,
            &mut settings,
            &mut credentials,
            Method::GET,
            "/admin/api/profile/providers/deleted",
            None,
        )?;
        if !response.status().is_success() {
            return Err(response_error(
                "Cloud provider recycle bin download",
                response,
            ));
        }
        let payload: DeletedCloudProvidersResponse = response
            .json()
            .map_err(|error| format!("Cloud provider recycle bin response is invalid: {error}"))?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(payload.providers)
    })
    .await
    .map_err(|error| format!("Cloud provider recycle bin task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_restore_deleted_provider<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let encoded_id = url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>();
        let response = cloud_request(
            &app,
            &client,
            &mut settings,
            &mut credentials,
            Method::POST,
            &format!("/admin/api/profile/providers/deleted/{encoded_id}/restore"),
            None,
        )?;
        if !response.status().is_success() {
            return Err(response_error("Cloud provider restore", response));
        }
        let remote = get_remote_providers(&app, &client, &mut settings, &mut credentials)?;
        let provider = remote
            .providers
            .into_iter()
            .find(|provider| provider.id == id)
            .ok_or_else(|| "The restored provider is not available for download".to_string())?;
        with_cloud_session(&app, &credentials, || {
            apply_remote_provider(&app, &provider)
        })?;
        settings.cloud_last_sync_at = Some(Utc::now().to_rfc3339());
        persist_cloud_sync(&app, &settings, &credentials)?;
        app.emit("providers-changed", ())
            .map_err(|error| error.to_string())?;
        crate::system_tray::refresh_menu(&app);
        Ok(CloudSyncResult {
            uploaded: 0,
            downloaded: 1,
        })
    })
    .await
    .map_err(|error| format!("Cloud provider restore task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_delete_provider<R: Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        delete_remote_provider(&app, &client, &mut settings, &mut credentials, &id)?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(CloudSyncResult {
            uploaded: 0,
            downloaded: 0,
        })
    })
    .await
    .map_err(|error| format!("Cloud provider delete task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_sync_accounts<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let local_ids = collect_local_accounts(&app)?
            .into_iter()
            .map(|account| account.id)
            .collect::<HashSet<_>>();
        let local_provider_ids = collect_local_providers(&app)?
            .into_iter()
            .map(|provider| provider.id)
            .collect::<HashSet<_>>();
        let remote_accounts = get_remote_accounts(&app, &client, &mut settings, &mut credentials)?;
        let mut downloaded = 0;
        for account_id in &remote_accounts.deleted_account_ids {
            if with_cloud_session(&app, &credentials, || {
                apply_remote_account_deletion(&app, account_id)
            })? {
                downloaded += 1;
            }
        }
        for account in remote_accounts.accounts {
            let is_new = !local_ids.contains(&account.id);
            let applied =
                with_cloud_session(&app, &credentials, || apply_remote_account(&app, &account))?;
            if is_new || applied {
                downloaded += 1;
            }
        }
        let mut providers_downloaded = 0;
        let remote_providers =
            get_remote_providers(&app, &client, &mut settings, &mut credentials)?;
        for provider_id in &remote_providers.deleted_provider_ids {
            if with_cloud_session(&app, &credentials, || {
                apply_remote_provider_deletion(&app, provider_id)
            })? {
                providers_downloaded += 1;
            }
        }
        for provider in remote_providers.providers {
            let is_new = !local_provider_ids.contains(&provider.id);
            let applied = with_cloud_session(&app, &credentials, || {
                apply_remote_provider(&app, &provider)
            })?;
            if is_new || applied {
                providers_downloaded += 1;
            }
        }
        downloaded += providers_downloaded;
        let uploaded = put_remote_accounts(&app, &client, &mut settings, &mut credentials)?
            + put_remote_providers(&app, &client, &mut settings, &mut credentials)?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        if downloaded > 0 {
            app.emit("accounts-changed", ())
                .map_err(|error| error.to_string())?;
            crate::system_tray::refresh_menu(&app);
        }
        if providers_downloaded > 0 {
            app.emit("providers-changed", ())
                .map_err(|error| error.to_string())?;
            crate::system_tray::refresh_menu(&app);
        }
        Ok(CloudSyncResult {
            uploaded,
            downloaded,
        })
    })
    .await
    .map_err(|error| format!("Cloud sync task failed: {error}"))?
}
