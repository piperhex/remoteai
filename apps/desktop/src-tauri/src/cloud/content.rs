use super::*;

#[tauri::command]
pub(crate) async fn fetch_cloud_announcement<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudAnnouncement, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let settings = read_app_settings(&app)?;
        let response = client
            .get(endpoint(&settings, "/announcements/current")?)
            .header("Accept", "application/json")
            .send()
            .map_err(|error| format!("Announcement request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error("Announcement request", response));
        }
        response
            .json()
            .map_err(|error| format!("Announcement response is invalid: {error}"))
    })
    .await
    .map_err(|error| format!("Announcement request task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn fetch_cloud_notifications<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<CloudNotification>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let settings = read_app_settings(&app)?;
        let response = client
            .get(endpoint(&settings, "/notifications/recent")?)
            .header("Accept", "application/json")
            .send()
            .map_err(|error| format!("Notification request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error("Notification request", response));
        }
        response
            .json()
            .map_err(|error| format!("Notification response is invalid: {error}"))
    })
    .await
    .map_err(|error| format!("Notification request task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn fetch_cloud_faqs<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<CloudFaq>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let settings = read_app_settings(&app)?;
        let response = client
            .get(endpoint(&settings, "/faqs")?)
            .header("Accept", "application/json")
            .send()
            .map_err(|error| format!("FAQ request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error("FAQ request", response));
        }
        response
            .json()
            .map_err(|error| format!("FAQ response is invalid: {error}"))
    })
    .await
    .map_err(|error| format!("FAQ request task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn fetch_cloud_currency_rates<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<CloudCurrencyRates, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = api_client()?;
        let settings = read_app_settings(&app)?;
        let response = client
            .get(endpoint(&settings, "/currency-rates")?)
            .header("Accept", "application/json")
            .send()
            .map_err(|error| format!("Currency rate request failed: {error}"))?;
        if !response.status().is_success() {
            return Err(response_error("Currency rate request", response));
        }
        response
            .json()
            .map_err(|error| format!("Currency rate response is invalid: {error}"))
    })
    .await
    .map_err(|error| format!("Currency rate request task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn report_announcement_click<R: Runtime>(
    app: tauri::AppHandle<R>,
    link: String,
    announcement_updated_at: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let installation = read_or_create_installation_state(&app)?;
        let client = api_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let authenticated =
            credentials.access_token.is_some() && credentials.refresh_token.is_some();
        let path = if authenticated {
            "/announcements/clicks/authenticated"
        } else {
            "/announcements/clicks"
        };
        let payload = json!({
            "deviceId": installation.device_id,
            "platform": installation.platform,
            "link": link,
            "announcementUpdatedAt": announcement_updated_at,
        });

        let response = if authenticated {
            let response = cloud_request(
                &app,
                &client,
                &mut settings,
                &mut credentials,
                Method::POST,
                path,
                Some(payload),
            )?;
            persist_cloud_sync(&app, &settings, &credentials)?;
            response
        } else {
            client
                .post(endpoint(&settings, path)?)
                .header("Accept", "application/json")
                .json(&payload)
                .send()
                .map_err(|error| format!("Announcement click report failed: {error}"))?
                .into()
        };
        if !response.status().is_success() {
            return Err(response_error("Announcement click report", response));
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Announcement click report task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn submit_feedback<R: Runtime>(
    app: tauri::AppHandle<R>,
    content: String,
    version: String,
    platform: String,
    contact_email: Option<String>,
    images: Vec<FeedbackImageInput>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let images = decode_feedback_images(images)?;
        let contact_email = contact_email
            .as_deref()
            .map(str::trim)
            .filter(|email| !email.is_empty());
        validate_feedback(&content, &version, &platform, contact_email, &images)?;
        let client = feedback_client()?;
        let (mut settings, mut credentials) = cloud_snapshot(&app)?;
        let authenticated =
            credentials.access_token.is_some() && credentials.refresh_token.is_some();
        let path = if authenticated {
            "/feedback/authenticated"
        } else {
            "/feedback"
        };
        let mut final_response = None;

        for attempt in 0..if authenticated { 2 } else { 1 } {
            if authenticated {
                prepare_cloud_request(&app, &settings, &mut credentials)?;
            }
            let mut request = client
                .post(endpoint(&settings, path)?)
                .header("Accept", "application/json")
                .multipart(feedback_form(
                    &content,
                    &version,
                    &platform,
                    contact_email,
                    &images,
                )?);
            if let Some(access_token) = credentials.access_token.as_ref().filter(|_| authenticated)
            {
                request = request.bearer_auth(access_token);
            }
            let response = request
                .send()
                .map_err(|error| format!("Feedback submission failed: {error}"))?;
            if !authenticated || response.status() != StatusCode::UNAUTHORIZED || attempt == 1 {
                final_response = Some(if authenticated {
                    CloudResponse::authenticated(&app, &credentials, response)?
                } else {
                    response.into()
                });
                break;
            }
            refresh_cloud_token(&app, &client, &mut settings, &mut credentials)?;
        }

        if authenticated {
            persist_cloud_sync(&app, &settings, &credentials)?;
        }
        let response = final_response.ok_or_else(|| "Feedback submission failed".to_string())?;
        if !response.status().is_success() {
            return Err(response_error("Feedback submission", response));
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Feedback submission task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn report_first_installation<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<bool, String> {
    if !telemetry_enabled() {
        return Ok(false);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut installation = read_or_create_installation_state(&app)?;
        let app_version = app.package_info().version.to_string();
        if installation.reported_at.is_some()
            && installation.reported_version.as_deref() == Some(app_version.as_str())
        {
            return Ok(false);
        }

        post_device_event(&app, &installation, "installation")?;

        if installation.reported_at.is_none() {
            installation.reported_at = Some(Utc::now().to_rfc3339());
        }
        installation.reported_version = Some(app_version);
        let value = serde_json::to_value(&installation).map_err(|error| error.to_string())?;
        write_json_atomic(&installation_state_path(&app)?, &value)?;
        Ok(true)
    })
    .await
    .map_err(|error| format!("Installation report task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn report_device_activity<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || report_device_activity_blocking(&app))
        .await
        .map_err(|error| format!("Device activity report task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn report_base_url_change<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    if !telemetry_enabled() {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let installation = read_or_create_installation_state(&app)?;
        post_device_event(&app, &installation, "base_url_changed")
    })
    .await
    .map_err(|error| format!("Base URL change report task failed: {error}"))?
}
