use super::*;

#[tauri::command]
pub(crate) async fn get_cloud_auth_state<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
) -> Result<CloudAuthState, String> {
    tauri::async_runtime::spawn_blocking(move || get_cloud_auth_state_blocking(&app))
        .await
        .map_err(|error| format!("Cloud auth state task failed: {error}"))?
}

pub(super) fn get_cloud_auth_state_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<CloudAuthState, String> {
    let (settings, credentials) = cloud_snapshot(app)?;
    Ok(cloud_state(&settings, &credentials))
}

#[tauri::command]
pub(crate) async fn get_saved_cloud_login<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Option<SavedCloudLogin>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let settings = read_app_settings(&app)?;
        read_saved_cloud_login(&settings)
    })
    .await
    .map_err(|error| format!("Saved cloud login task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn set_cloud_base_url<R: Runtime + 'static>(
    app: tauri::AppHandle<R>,
    base_url: String,
) -> Result<CloudAuthState, String> {
    tauri::async_runtime::spawn_blocking(move || set_cloud_base_url_blocking(&app, base_url))
        .await
        .map_err(|error| format!("Cloud base URL task failed: {error}"))?
}

pub(super) fn set_cloud_base_url_blocking<R: Runtime>(
    app: &tauri::AppHandle<R>,
    base_url: String,
) -> Result<CloudAuthState, String> {
    with_cloud_data(app, || {
        let _credentials_guard = lock_cloud_credentials()?;
        let mut settings = read_app_settings(app)?;
        let normalized = normalize_base_url(&base_url)?;
        if settings.cloud_base_url != normalized {
            clear_cloud_profile(&mut settings);
            settings.cloud_session_expired = false;
            invalidate_cloud_session(app)?;
            clear_cloud_credentials(app)?;
        }
        settings.cloud_base_url = normalized;
        if settings.cloud_base_url.is_none() {
            clear_cloud_profile(&mut settings);
            settings.cloud_session_expired = false;
            invalidate_cloud_session(app)?;
            clear_cloud_credentials(app)?;
        }
        write_app_settings(app, &settings)?;
        let credentials = read_cloud_credentials(app);
        Ok(cloud_state(&settings, &credentials))
    })
}

#[tauri::command]
pub(crate) async fn cloud_login<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
    password: String,
    remember_password: bool,
) -> Result<CloudAuthenticationResult, String> {
    cloud_authenticate(
        app,
        email,
        password,
        None,
        remember_password,
        "/auth/login",
        "Cloud login",
    )
    .await
}

pub(super) fn feedback_form(
    content: &str,
    version: &str,
    platform: &str,
    contact_email: Option<&str>,
    images: &[FeedbackImage],
) -> Result<multipart::Form, String> {
    let mut form = multipart::Form::new()
        .text("content", content.to_string())
        .text("version", version.to_string())
        .text("platform", platform.to_string());
    if let Some(contact_email) = contact_email {
        form = form.text("email", contact_email.to_string());
    }
    for image in images {
        let part = multipart::Part::bytes(image.data.clone())
            .file_name(image.file_name.clone())
            .mime_str(&image.mime_type)
            .map_err(|error| format!("Feedback image type is invalid: {error}"))?;
        form = form.part("images", part);
    }
    Ok(form)
}

pub(super) fn validate_feedback(
    content: &str,
    version: &str,
    platform: &str,
    contact_email: Option<&str>,
    images: &[FeedbackImage],
) -> Result<(), String> {
    if content.trim().is_empty() || content.chars().count() > 5_000 {
        return Err("Feedback must contain between 1 and 5000 characters".to_string());
    }
    if version.trim().is_empty() || version.chars().count() > 40 {
        return Err("Feedback version is invalid".to_string());
    }
    if platform.trim().is_empty() || platform.chars().count() > 500 {
        return Err("Feedback platform information is invalid".to_string());
    }
    if let Some(contact_email) = contact_email {
        if contact_email.len() > 160 || !contact_email.contains('@') {
            return Err("Feedback contact email is invalid".to_string());
        }
    }
    if images.len() > MAX_FEEDBACK_IMAGES {
        return Err(format!(
            "At most {MAX_FEEDBACK_IMAGES} feedback images are allowed"
        ));
    }
    for image in images {
        if !FEEDBACK_IMAGE_MIME_TYPES.contains(&image.mime_type.as_str()) {
            return Err("Only JPEG, PNG and WebP feedback images are supported".to_string());
        }
        if image.data.len() > MAX_FEEDBACK_IMAGE_BYTES {
            return Err("Each feedback image must not exceed 5 MB".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn cloud_register<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
    password: String,
    verification_code: String,
    remember_password: bool,
) -> Result<CloudAuthenticationResult, String> {
    cloud_authenticate(
        app,
        email,
        password,
        Some(verification_code),
        remember_password,
        "/auth/register",
        "Cloud registration",
    )
    .await
}

#[tauri::command]
pub(crate) async fn cloud_change_password<R: Runtime>(
    app: tauri::AppHandle<R>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let remembered_new_password = new_password.clone();
        let response = cloud_request(
            &app,
            &client,
            &mut settings,
            &mut credentials,
            Method::PATCH,
            "/admin/api/profile/password",
            Some(json!({
                "currentPassword": current_password,
                "newPassword": new_password,
            })),
        )?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        if !response.status().is_success() {
            return Err(response_error("Cloud password change", response));
        }
        with_cloud_session(&app, &credentials, || {
            if let Ok(Some(mut saved_login)) = read_saved_cloud_login(&settings) {
                if settings.cloud_user_email.as_deref() == Some(saved_login.email.as_str()) {
                    saved_login.password = remembered_new_password;
                    if let Err(error) = update_saved_cloud_login(&settings, Some(&saved_login)) {
                        eprintln!(
                            "could not update saved cloud login after password change: {error}"
                        );
                    }
                }
            }
            Ok(())
        })?;
        Ok(())
    })
    .await
    .map_err(|error| format!("Cloud password change task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_request_registration_code<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let settings = read_app_settings(&app)?;
        let response = client
            .post(endpoint(&settings, "/auth/register/code")?)
            .json(&json!({ "email": email }))
            .send()
            .map_err(|error| request_error("Verification code request", error))?;
        if !response.status().is_success() {
            return Err(response_error("Verification code request", response));
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Verification code request task failed: {error}"))?
}

pub(super) async fn cloud_authenticate<R: Runtime>(
    app: tauri::AppHandle<R>,
    email: String,
    password: String,
    verification_code: Option<String>,
    remember_password: bool,
    path: &'static str,
    action: &'static str,
) -> Result<CloudAuthenticationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let (settings, ticket) = authentication_session::begin_login(&app)?;
        let saved_login = SavedCloudLogin {
            email: email.trim().to_string(),
            password: password.clone(),
        };
        let mut payload = json!({ "email": email, "password": password });
        if let Some(code) = verification_code {
            payload["verificationCode"] = Value::String(code);
        }
        let response = client
            .post(endpoint(&settings, path)?)
            .json(&payload)
            .send()
            .map_err(|error| request_error(action, error))?;
        if !response.status().is_success() {
            return Err(response_error(action, response));
        }
        let tokens: CloudTokenResponse = response
            .json()
            .map_err(|error| format!("{action} response is invalid: {error}"))?;
        let replacement = tokens.refresh_token.clone();
        let committed = authentication_session::commit_login(&app, &ticket, tokens);
        let (mut settings, mut credentials) = match committed {
            Ok(snapshot) => snapshot,
            Err(error) => {
                revoke_cloud_token(&client, &settings, &replacement);
                return Err(error);
            }
        };
        // Commit authentication before I/O so every subsequent request shares the
        // same session and rotated tokens can never be lost on a failed sync.
        let sync_warning = authentication_session::merge_login_data(
            &app,
            &client,
            &mut settings,
            &mut credentials,
        )?;
        let (password_saved, credential_storage_updated) =
            with_cloud_session(&app, &credentials, || {
                Ok(if remember_password {
                    match update_saved_cloud_login(&settings, Some(&saved_login)) {
                        Ok(()) => (true, true),
                        Err(error) => {
                            eprintln!("could not save cloud login: {error}");
                            (false, false)
                        }
                    }
                } else {
                    match update_saved_cloud_login(&settings, None) {
                        Ok(()) => (false, true),
                        Err(error) => {
                            eprintln!("could not remove saved cloud login: {error}");
                            (false, false)
                        }
                    }
                })
            })?;
        persist_cloud_sync(&app, &settings, &credentials)?;
        Ok(CloudAuthenticationResult {
            state: cloud_state(&settings, &credentials),
            password_saved,
            credential_storage_updated,
            sync_warning,
        })
    })
    .await
    .map_err(|error| format!("{action} task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cloud_logout<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudAuthState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (state, settings, credentials) = authentication_session::logout_local(&app)?;
        if let Some(token) = credentials
            .refresh_token
            .as_deref()
            .filter(|_| settings.cloud_base_url.is_some())
        {
            revoke_cloud_token(&api_client()?, &settings, token);
        }
        Ok(state)
    })
    .await
    .map_err(|error| format!("Cloud logout task failed: {error}"))?
}
