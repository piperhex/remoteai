use super::*;

pub(super) fn cloud_credentials_path<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate app data directory: {error}"))?
        .join("cloud-auth.json"))
}

pub(super) fn read_cloud_credentials<R: Runtime>(app: &tauri::AppHandle<R>) -> CloudCredentials {
    let mut credentials: CloudCredentials = cloud_credentials_path(app)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if credentials.device_id.is_none() {
        credentials.device_id = read_or_create_installation_state(app)
            .ok()
            .map(|installation| installation.device_id);
    }
    credentials
}

pub(super) fn write_cloud_credentials<R: Runtime>(
    app: &tauri::AppHandle<R>,
    credentials: &CloudCredentials,
) -> Result<(), String> {
    let value = serde_json::to_value(credentials).map_err(|error| error.to_string())?;
    write_json_atomic(&cloud_credentials_path(app)?, &value)
}

pub(super) fn clear_cloud_credentials<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let path = cloud_credentials_path(app)?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Failed to clear cloud credentials: {error}"))?;
    }
    Ok(())
}

pub(super) fn api_client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .gzip(true)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Failed to create cloud HTTP client: {error}"))
}

pub(super) fn feedback_client() -> Result<Client, String> {
    crate::system_proxy::apply(Client::builder())
        .gzip(true)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("Failed to create feedback HTTP client: {error}"))
}

pub(super) fn decode_feedback_images(
    inputs: Vec<FeedbackImageInput>,
) -> Result<Vec<FeedbackImage>, String> {
    if inputs.len() > MAX_FEEDBACK_IMAGES {
        return Err(format!(
            "At most {MAX_FEEDBACK_IMAGES} feedback images are allowed"
        ));
    }
    inputs
        .into_iter()
        .map(|input| {
            let maximum_base64_length = MAX_FEEDBACK_IMAGE_BYTES.div_ceil(3) * 4 + 4;
            if input.data_base64.len() > maximum_base64_length {
                return Err("Each feedback image must not exceed 5 MB".to_string());
            }
            let data = BASE64_STANDARD
                .decode(&input.data_base64)
                .map_err(|_| "Feedback image data is invalid".to_string())?;
            Ok(FeedbackImage {
                file_name: input.file_name,
                mime_type: input.mime_type,
                data,
            })
        })
        .collect()
}

pub(super) fn normalize_base_url(value: &str) -> Result<Option<String>, String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(None);
    }
    let url =
        url::Url::parse(trimmed).map_err(|error| format!("Cloud base URL is invalid: {error}"))?;
    match url.scheme() {
        "http" | "https" => Ok(Some(trimmed.to_string())),
        _ => Err("Cloud base URL must start with http:// or https://".to_string()),
    }
}

pub(super) fn cloud_state(
    settings: &AppSettings,
    credentials: &CloudCredentials,
) -> CloudAuthState {
    let enabled = settings
        .cloud_base_url
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    CloudAuthState {
        enabled,
        base_url: settings.cloud_base_url.clone(),
        authenticated: enabled
            && credentials.access_token.is_some()
            && credentials.refresh_token.is_some(),
        user_email: settings.cloud_user_email.clone(),
        user_id: settings.cloud_user_id.clone(),
        last_sync_at: settings.cloud_last_sync_at.clone(),
        session_expired: settings.cloud_session_expired,
    }
}

pub(super) fn clear_cloud_profile(settings: &mut AppSettings) {
    settings.cloud_user_email = None;
    settings.cloud_user_id = None;
    settings.cloud_last_sync_at = None;
}

pub(super) fn saved_cloud_login_service(settings: &AppSettings) -> Result<String, String> {
    let base_url = base_url(settings)?;
    let digest = Sha256::digest(base_url.as_bytes());
    Ok(format!("codex-switch-cloud-login-{digest:x}"))
}

pub(super) fn saved_cloud_login_entry(settings: &AppSettings) -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        &saved_cloud_login_service(settings)?,
        CLOUD_LOGIN_KEYRING_USER,
    )
    .map_err(|error| format!("Could not access the system credential store: {error}"))
}

pub(super) fn read_saved_cloud_login(
    settings: &AppSettings,
) -> Result<Option<SavedCloudLogin>, String> {
    let entry = saved_cloud_login_entry(settings)?;
    let value = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Could not read the saved cloud login from the system credential store: {error}"
            ))
        }
    };
    serde_json::from_str(&value)
        .map(Some)
        .map_err(|error| format!("The saved cloud login is invalid: {error}"))
}

pub(super) fn update_saved_cloud_login(
    settings: &AppSettings,
    saved_login: Option<&SavedCloudLogin>,
) -> Result<(), String> {
    let entry = saved_cloud_login_entry(settings)?;
    if let Some(saved_login) = saved_login {
        let value = serde_json::to_string(saved_login)
            .map_err(|error| format!("Could not encode the saved cloud login: {error}"))?;
        return entry.set_password(&value).map_err(|error| {
            format!("Could not save the cloud login in the system credential store: {error}")
        });
    }
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Could not remove the saved cloud login from the system credential store: {error}"
        )),
    }
}

pub(super) fn expire_cloud_session<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &mut AppSettings,
) -> Result<(), String> {
    clear_cloud_profile(settings);
    settings.cloud_session_expired = true;
    let clear_result = clear_cloud_credentials(app);
    let settings_result = write_app_settings(app, settings);
    let emit_result = app
        .emit(CLOUD_SESSION_EXPIRED_EVENT, ())
        .map_err(|error| format!("Could not notify the app that cloud login expired: {error}"));
    clear_result?;
    settings_result?;
    emit_result
}

pub(super) fn base_url(settings: &AppSettings) -> Result<&str, String> {
    settings
        .cloud_base_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "Cloud login is disabled. Configure a server base URL in Settings first.".to_string()
        })
}

pub(super) fn endpoint(settings: &AppSettings, path: &str) -> Result<String, String> {
    Ok(format!("{}{}", base_url(settings)?, path))
}

pub(super) fn response_error(action: &str, response: impl Into<CloudResponse>) -> String {
    let response = response.into();
    let status = response.status();
    let detail = response.text().unwrap_or_default();
    if detail.trim().is_empty() {
        format!("{action} failed with HTTP {status}")
    } else {
        format!("{action} failed with HTTP {status}: {detail}")
    }
}

pub(super) fn persist_cloud_token_response<WriteCredentials, WriteSettings>(
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    tokens: CloudTokenResponse,
    write_credentials: WriteCredentials,
    write_settings: WriteSettings,
) -> Result<(), String>
where
    WriteCredentials: FnOnce(&CloudCredentials) -> Result<(), String>,
    WriteSettings: FnOnce(&AppSettings) -> Result<(), String>,
{
    credentials.access_token = Some(tokens.access_token);
    credentials.refresh_token = Some(tokens.refresh_token);
    if let Some(user) = tokens.user {
        settings.cloud_user_id = Some(user.id);
        settings.cloud_user_email = Some(user.email);
    }

    // The backend has already revoked the old refresh token. Store its
    // replacement before any ancillary settings write or business retry.
    write_credentials(credentials)?;
    write_settings(settings)?;
    Ok(())
}

pub(super) fn refresh_rejection_expires_cloud_session(status: StatusCode) -> bool {
    matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
}

pub(super) fn access_token_expires_soon(access_token: &str) -> bool {
    let Some(payload) = access_token.split('.').nth(1) else {
        return true;
    };
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| URL_SAFE.decode(payload));
    let Ok(decoded) = decoded else {
        return true;
    };
    let Ok(payload) = serde_json::from_slice::<Value>(&decoded) else {
        return true;
    };
    payload
        .get("exp")
        .and_then(Value::as_i64)
        .is_none_or(|expires_at| expires_at <= Utc::now().timestamp() + 60)
}

pub(crate) fn remote_control_config<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Option<RemoteControlConfig>, String> {
    let (mut settings, mut credentials) = cloud_snapshot(app)?;
    let Some(mut access_token) = credentials.access_token.clone() else {
        return Ok(None);
    };
    if credentials.refresh_token.is_none() || settings.cloud_user_id.is_none() {
        return Ok(None);
    }
    if access_token_expires_soon(&access_token) {
        let client = api_client()?;
        refresh_cloud_token(app, &client, &mut settings, &mut credentials)?;
        access_token = credentials
            .access_token
            .clone()
            .ok_or_else(|| "Cloud access token is missing after refresh".to_string())?;
    }

    let mut url = url::Url::parse(base_url(&settings)?)
        .map_err(|error| format!("Cloud base URL is invalid: {error}"))?;
    let websocket_scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        _ => return Err("Cloud base URL must use HTTP or HTTPS".to_string()),
    };
    url.set_scheme(websocket_scheme)
        .map_err(|_| "Could not build the remote control WebSocket URL".to_string())?;
    let base_path = url.path().trim_end_matches('/');
    url.set_path(&format!("{base_path}/device-switch"));
    url.set_query(None);
    url.set_fragment(None);

    ensure_cloud_session(app, &credentials)?;
    let installation = read_or_create_installation_state(app)?;
    let manager_state = read_state(&resolve_paths(app)?);
    Ok(Some(RemoteControlConfig {
        gui_selection: crate::codex_gui::account_selection::read(app)
            .map_err(|error| error.to_string())?,
        websocket_url: url.to_string(),
        access_token,
        device_id: installation.device_id,
        device_name: sysinfo::System::host_name().unwrap_or_else(|| "Remote AI".to_string()),
        platform: installation.platform,
        app_version: app.package_info().version.to_string(),
        active_account_id: manager_state.active_account_id,
        openai_auth_account_id: manager_state.local_proxy_openai_auth_account_id,
        active_provider_id: manager_state.active_provider_id,
        active_provider_group: manager_state.active_provider_group,
        local_proxy_running: crate::local_proxy::is_running(),
    }))
}

pub(super) fn cloud_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    client: &Client,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<CloudResponse, String> {
    for attempt in 0..2 {
        prepare_cloud_request(app, settings, credentials)?;
        let access_token = credentials
            .access_token
            .clone()
            .ok_or_else(|| "Cloud access token is missing. Please log in again.".to_string())?;
        let mut request = client
            .request(method.clone(), endpoint(settings, path)?)
            .bearer_auth(access_token)
            .header("Accept", "application/json");
        if let Some(device_id) = credentials.device_id.as_deref() {
            request = request.header("X-Device-ID", device_id);
        }
        if let Some(payload) = body.as_ref() {
            request = request.json(payload);
        }
        let response = request
            .send()
            .map_err(|error| request_error("Cloud request", error))?;
        if response.status() != StatusCode::UNAUTHORIZED || attempt == 1 {
            return CloudResponse::authenticated(app, credentials, response);
        }
        refresh_cloud_token(app, client, settings, credentials)?;
    }
    unreachable!("cloud_request returns inside the retry loop")
}
