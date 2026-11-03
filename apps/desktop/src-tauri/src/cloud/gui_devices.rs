use super::*;

/// Public computer information; cloud credentials never leave the native backend.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuiDevice {
    device_id: String,
    name: String,
    platform: String,
    online: bool,
}

#[derive(Deserialize)]
struct DevicesResponse {
    devices: Vec<GuiDevice>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuiCloudIdentity {
    pub(crate) base_url: String,
    pub(crate) user_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GuiDeviceDirectory {
    identity: Option<GuiCloudIdentity>,
    current_device_id: String,
    devices: Vec<GuiDevice>,
}

#[derive(Debug, thiserror::Error)]
enum DirectoryError {
    #[error("请重新登录后查看其他电脑。")]
    Authentication,
    #[error("暂时无法读取电脑列表，请重试。")]
    Unavailable,
}

fn read_directory<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<GuiDeviceDirectory, DirectoryError> {
    let (mut settings, mut credentials) =
        cloud_snapshot(app).map_err(|_| DirectoryError::Unavailable)?;
    let installation =
        read_or_create_installation_state(app).map_err(|_| DirectoryError::Unavailable)?;
    let mut directory = GuiDeviceDirectory {
        identity: None,
        current_device_id: installation.device_id,
        devices: Vec::new(),
    };
    if !cloud_state(&settings, &credentials).authenticated {
        return Ok(directory);
    }
    let response = load_devices(app, &mut settings, &mut credentials)?;
    directory.identity = Some(GuiCloudIdentity {
        base_url: base_url(&settings)
            .map_err(|_| DirectoryError::Authentication)?
            .to_owned(),
        user_id: settings
            .cloud_user_id
            .ok_or(DirectoryError::Authentication)?,
    });
    directory.devices = response
        .devices
        .into_iter()
        .filter(|device| device.device_id != directory.current_device_id)
        .collect();
    Ok(directory)
}

fn load_devices<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &mut AppSettings,
    credentials: &mut CloudCredentials,
) -> Result<DevicesResponse, DirectoryError> {
    let client = api_client().map_err(|_| DirectoryError::Unavailable)?;
    let response = cloud_request(
        app,
        &client,
        settings,
        credentials,
        Method::GET,
        "/devices",
        None,
    )
    .map_err(|_| DirectoryError::Unavailable)?;
    if matches!(
        response.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) {
        return Err(DirectoryError::Authentication);
    }
    response
        .error_for_status()
        .map_err(|_| DirectoryError::Unavailable)?
        .json()
        .map_err(|_| DirectoryError::Unavailable)
}

#[tauri::command]
pub(crate) async fn codex_gui_devices<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<GuiDeviceDirectory, String> {
    tauri::async_runtime::spawn_blocking(move || read_directory(&app))
        .await
        .map_err(|_| DirectoryError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}
