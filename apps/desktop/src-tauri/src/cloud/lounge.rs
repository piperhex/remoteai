use super::*;

#[derive(Debug, thiserror::Error)]
enum LoungeError {
    #[error("client.lounge.signIn")]
    Authentication,
    #[error("client.lounge.unavailable")]
    Unavailable,
}

/// Only a short-lived lounge credential crosses IPC; it cannot authorize other cloud APIs.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LoungeTicket {
    ticket: String,
}

fn ticket(app: &tauri::AppHandle, identity: GuiCloudIdentity) -> Result<LoungeTicket, LoungeError> {
    let (mut settings, mut credentials) =
        cloud_snapshot(app).map_err(|_| LoungeError::Unavailable)?;
    if base_url(&settings).ok() != Some(identity.base_url.as_str())
        || settings.cloud_user_id.as_deref() != Some(&identity.user_id)
        || !cloud_state(&settings, &credentials).authenticated
    {
        return Err(LoungeError::Authentication);
    }
    let client = api_client().map_err(|_| LoungeError::Unavailable)?;
    cloud_request(
        app,
        &client,
        &mut settings,
        &mut credentials,
        Method::POST,
        "/lounge/ticket",
        None,
    )
    .map_err(|_| LoungeError::Unavailable)?
    .error_for_status()
    .map_err(|_| LoungeError::Unavailable)?
    .json()
    .map_err(|_| LoungeError::Unavailable)
}

/// Credential locks, storage reads and network requests run entirely on a blocking worker.
#[tauri::command]
pub(crate) async fn cloud_lounge_ticket(
    app: tauri::AppHandle,
    identity: GuiCloudIdentity,
) -> Result<LoungeTicket, String> {
    tauri::async_runtime::spawn_blocking(move || ticket(&app, identity))
        .await
        .map_err(|_| LoungeError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}
