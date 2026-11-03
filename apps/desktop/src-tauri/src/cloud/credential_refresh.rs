//! Only refreshes for the same login serialize; normal requests never wait here.
use super::*;

pub(super) fn refresh_cloud_token<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<(), String> {
    let snapshot = credentials
        .session
        .clone()
        .ok_or(SessionError::Changed.to_string())?;
    snapshot.epoch.refresh.run(snapshot.refresh_version, || {
        perform_refresh(app, client, settings, credentials)
    })?;
    prepare_cloud_request(app, settings, credentials)
}

fn perform_refresh<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<(), String> {
    let previous = credentials.clone();
    prepare_cloud_request(app, settings, credentials)?;
    if credentials.refresh_token != previous.refresh_token
        || credentials.access_token != previous.access_token
    {
        return Ok(());
    }
    let response = request_refresh(client, settings, credentials)?;
    if !response.status().is_success() {
        return reject_refresh(app, credentials, response);
    }
    let tokens: CloudTokenResponse = response
        .json()
        .map_err(|error| format!("Cloud token refresh response is invalid: {error}"))?;
    let replacement = tokens.refresh_token.clone();
    let result = commit_refresh(app, credentials, tokens);
    match result {
        Ok((current_settings, current_credentials)) => {
            settings.cloud_user_email = current_settings.cloud_user_email;
            *credentials = current_credentials;
            Ok(())
        }
        Err(error) => {
            // A concurrent logout may have revoked only the old token. Revoke the
            // discarded rotation against its original server, never the new server.
            if ensure_cloud_session(app, credentials).is_err() {
                revoke_cloud_token(client, settings, &replacement);
            }
            Err(error)
        }
    }
}

fn request_refresh(
    client: &Client,
    settings: &AppSettings,
    credentials: &CloudCredentials,
) -> Result<reqwest::blocking::Response, String> {
    let refresh_token = credentials
        .refresh_token
        .as_deref()
        .ok_or_else(|| "Cloud refresh token is missing. Please log in again.".to_string())?;
    client
        .post(endpoint(settings, "/auth/refresh")?)
        .json(&json!({ "refreshToken": refresh_token }))
        .send()
        .map_err(|error| request_error("Cloud token refresh", error))
}

fn commit_refresh<R: Runtime>(
    app: &tauri::AppHandle<R>,
    expected: &CloudCredentials,
    tokens: CloudTokenResponse,
) -> Result<(AppSettings, CloudCredentials), String> {
    let _guard = lock_cloud_credentials()?;
    let (mut settings, mut current) = current_cloud_snapshot(app, expected)?;
    if current.refresh_token != expected.refresh_token
        || current.access_token != expected.access_token
    {
        return Ok((settings, current));
    }
    if tokens
        .user
        .as_ref()
        .is_some_and(|user| settings.cloud_user_id.as_deref() != Some(&user.id))
    {
        return Err(SessionError::Changed.to_string());
    }
    persist_cloud_token_response(
        &mut settings,
        &mut current,
        tokens,
        |credentials| write_cloud_credentials(app, credentials),
        |settings| write_app_settings(app, settings),
    )?;
    Ok((settings, current))
}

fn reject_refresh<R: Runtime>(
    app: &tauri::AppHandle<R>,
    expected: &CloudCredentials,
    response: reqwest::blocking::Response,
) -> Result<(), String> {
    let expires = refresh_rejection_expires_cloud_session(response.status());
    // Read even an error body without a credential/data lock.
    let server_error = response_error("Cloud token refresh", response);
    if !expires {
        return Err(server_error);
    }
    with_cloud_data(app, || {
        let _guard = lock_cloud_credentials()?;
        let (mut settings, current) = current_cloud_snapshot(app, expected)?;
        if current.refresh_token != expected.refresh_token {
            return Ok(());
        }
        expire_cloud_epoch(app)?;
        expire_cloud_session(app, &mut settings)
    })?;
    Err("Cloud login expired. Please sign in again to continue cloud synchronization.".to_string())
}

/// Remote logout is best effort, as before; local invalidation never waits for it.
pub(super) fn revoke_cloud_token(client: &Client, settings: &AppSettings, token: &str) {
    let result = endpoint(settings, "/auth/logout").and_then(|url| {
        client
            .post(url)
            .json(&json!({ "refreshToken": token }))
            .send()
            .map_err(|error| request_error("Cloud logout", error))
    });
    if result.is_err() {
        eprintln!("Cloud logout could not reach the server");
    }
}
