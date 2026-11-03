use super::*;

/// Called only on a blocking worker; retries retain the original report ID and account.
pub(crate) fn report_update_download<R: Runtime>(
    app: &tauri::AppHandle<R>,
    expected: &PushRoute,
    body: Value,
) {
    for attempt in 0..3 {
        match send(app, expected, &body) {
            Ok(true) => return,
            Ok(false) => break,
            Err(()) if attempt < 2 => std::thread::sleep(Duration::from_secs(2)),
            Err(()) => break,
        }
    }
    eprintln!("Download statistics could not be reported");
}

fn send<R: Runtime>(
    app: &tauri::AppHandle<R>,
    expected: &PushRoute,
    body: &Value,
) -> Result<bool, ()> {
    let (mut settings, mut credentials) = cloud_snapshot(app).map_err(|_| ())?;
    if settings.cloud_user_id.as_deref() != Some(expected.owner_id.as_str())
        || base_url(&settings).map_err(|_| ())?.trim_end_matches('/') != expected.base_url
    {
        return Ok(false);
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| ())?;
    let response = cloud_request(
        app,
        &client,
        &mut settings,
        &mut credentials,
        Method::POST,
        "/update-sharing/reports",
        Some(body.clone()),
    )
    .map_err(|_| ())?;
    if response.status().is_success() {
        return Ok(true);
    }
    if response.status().is_server_error() || response.status() == StatusCode::TOO_MANY_REQUESTS {
        return Err(());
    }
    Ok(false)
}
