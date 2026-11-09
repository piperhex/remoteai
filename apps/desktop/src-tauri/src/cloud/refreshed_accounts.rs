//! Publish committed credentials even when the following usage request fails or has no UI caller.
use super::*;

const UPLOAD_ATTEMPTS: u64 = 3;

pub(crate) async fn pull_refreshed_account<R: Runtime>(
    app: &tauri::AppHandle<R>,
    expected_access_token: &str,
    id: &str,
) -> Result<(), String> {
    let app = app.clone();
    let expected_access_token = expected_access_token.to_owned();
    let id = id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        // Ignore messages queued on a socket authenticated before logout or a token change.
        if credentials.access_token.as_deref() != Some(expected_access_token.as_str()) {
            return Ok(());
        }
        let remote = get_remote_accounts(&app, &api_client()?, &mut settings, &mut credentials)?;
        let Some(account) = remote.accounts.into_iter().find(|account| account.id == id) else {
            return Ok(());
        };
        let changed = with_cloud_session(&app, &credentials, || {
            apply_remote_account_with_activation(&app, &account, false)
        })?;
        if changed {
            app.emit("accounts-changed", ())
                .map_err(|error| error.to_string())?;
        }
        persist_cloud_sync(&app, &settings, &credentials)
    })
    .await
    .map_err(|error| format!("Account credential download task failed: {error}"))?
}

pub(crate) fn refreshed_account_uploader<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<impl Fn() + Send + 'static, String> {
    // Capture the login generation before requesting new Codex credentials. A later login must
    // never receive an upload from the previous cloud account, including delayed retries.
    let (settings, credentials) = cloud_snapshot(app)?;
    let app = app.clone();
    let id = id.to_owned();
    Ok(move || {
        if settings.cloud_user_id.is_none() || credentials.access_token.is_none() {
            return;
        }
        let app = app.clone();
        let id = id.clone();
        let mut settings = settings.clone();
        let mut credentials = credentials.clone();
        tauri::async_runtime::spawn_blocking(move || {
            for attempt in 1..=UPLOAD_ATTEMPTS {
                if ensure_cloud_session(&app, &credentials).is_err() {
                    return;
                }
                let result = api_client().and_then(|client| {
                    put_remote_account(&app, &client, &mut settings, &mut credentials, &id)?;
                    persist_cloud_sync(&app, &settings, &credentials)
                });
                match result {
                    Ok(()) => return,
                    Err(error) => {
                        eprintln!("Refreshed account upload attempt {attempt} failed: {error}")
                    }
                }
                if attempt < UPLOAD_ATTEMPTS {
                    std::thread::sleep(Duration::from_secs(attempt));
                }
            }
            // The saved Auth field timestamp remains dirty for a subsequent full sync.
        });
    })
}
