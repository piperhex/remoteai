//! Shared setup for explicit settings actions and the first local GUI connection.
use super::{configuration, installer, platform, Result, ServiceError};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager};

// Automatic setup and settings actions must not rotate credentials or elevate concurrently.
static CHANGES: Mutex<()> = Mutex::new(());

pub(super) fn supported() -> bool {
    cfg!(target_arch = "x86_64") && super::assets::ready()
}

/// Called only by Computer Use's persisted first-setup callback, on a blocking worker.
pub(crate) fn setup_gui(app: &AppHandle, installing: impl FnOnce()) -> Result<bool> {
    if !supported() {
        return Ok(false);
    }
    let _guard = CHANGES.lock().map_err(|_| ServiceError::Storage)?;
    // Preserve existing ownership, stopped services, and an explicit remote-access opt-out.
    if installer::query()?.is_some()
        || !crate::remote_desktop::permissions::snapshot(app)
            .map_err(|_| ServiceError::Storage)?
            .enabled
    {
        return Ok(false);
    }
    installing();
    install_inner(app)?;
    Ok(true)
}

pub(super) fn install(app: &AppHandle) -> Result<()> {
    let _guard = CHANGES.lock().map_err(|_| ServiceError::Storage)?;
    install_inner(app)
}

fn install_inner(app: &AppHandle) -> Result<()> {
    let (path, config) = prepare(app)?;
    let result = elevate("--install-desktop-service", Some(&path));
    if std::fs::remove_file(&path).is_err() {
        eprintln!("desktop service setup temporary cleanup failed");
    }
    if result.is_err() && revoke(&config).is_err() {
        eprintln!("unused desktop service credential revocation failed");
    }
    result
}

pub(super) fn uninstall() -> Result<()> {
    let _guard = CHANGES.lock().map_err(|_| ServiceError::Storage)?;
    elevate("--uninstall-desktop-service", None)
}

fn prepare(app: &AppHandle) -> Result<(PathBuf, configuration::Configuration)> {
    let executable = std::env::current_exe().map_err(|_| ServiceError::Setup)?;
    let source = executable.parent().ok_or(ServiceError::Setup)?;
    if !source.join("resources/desktop-service/node.exe").is_file() {
        return Err(ServiceError::Setup);
    }
    let cloud = crate::cloud::remote_control_config(app)
        .map_err(|_| ServiceError::Unavailable)?
        .ok_or_else(|| ServiceError::Remote("请先登录云端账号。".into()))?;
    let mut base = url::Url::parse(&cloud.websocket_url).map_err(|_| ServiceError::Invalid)?;
    if base.scheme() != "wss" {
        return Err(ServiceError::Remote("请使用安全连接的服务器地址。".into()));
    }
    base.set_scheme("https")
        .map_err(|_| ServiceError::Invalid)?;
    let path = base
        .path()
        .trim_end_matches("device-switch")
        .trim_end_matches('/')
        .to_owned();
    base.set_path(&path);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| ServiceError::Unavailable)?;
    // Resolve every fallible local input before issuing a new remote credential.
    let permissions =
        crate::remote_desktop::permissions::snapshot(app).map_err(|_| ServiceError::Storage)?;
    let mut secret =
        crate::remote_chat::identity::export_private_key().map_err(|_| ServiceError::Storage)?;
    let identity_secret = STANDARD.encode(secret);
    secret.fill(0);
    let owner_sid = platform::user_sid()?;
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| ServiceError::Storage)?
        .join("service-setup");
    std::fs::create_dir_all(&root).map_err(|_| ServiceError::Storage)?;
    let result = client
        .post(format!(
            "{}/devices/{}/service-credential",
            base.as_str().trim_end_matches('/'),
            cloud.device_id
        ))
        .bearer_auth(&cloud.access_token)
        .send()
        .map_err(|_| ServiceError::Unavailable)?;
    if !result.status().is_success() {
        return Err(ServiceError::Setup);
    }
    let body: serde_json::Value = result.json().map_err(|_| ServiceError::Setup)?;
    let config = configuration::Configuration {
        base_url: base.to_string().trim_end_matches('/').into(),
        credential: body["credential"]
            .as_str()
            .ok_or(ServiceError::Setup)?
            .into(),
        device_id: cloud.device_id,
        name: cloud.device_name,
        version: cloud.app_version,
        identity_secret,
        owner_sid,
        permissions,
    };
    let path = root.join(format!("{}.bin", uuid::Uuid::new_v4()));
    let saved = configuration::seal(&config)
        .and_then(|bytes| std::fs::write(&path, bytes).map_err(|_| ServiceError::Storage));
    if saved.is_err() && revoke(&config).is_err() {
        eprintln!("unused desktop service credential revocation pending");
    }
    saved?;
    Ok((path, config))
}

pub(super) fn revoke(config: &configuration::Configuration) -> Result<()> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| ServiceError::Unavailable)?;
    let result = client
        .post(format!(
            "{}/desktop-service/revoke",
            config.base_url.trim_end_matches('/')
        ))
        .bearer_auth(&config.credential)
        .send()
        .map_err(|_| ServiceError::Unavailable)?;
    if result.status().is_success() || result.status() == reqwest::StatusCode::UNAUTHORIZED {
        Ok(())
    } else {
        Err(ServiceError::Unavailable)
    }
}
fn elevate(action: &str, prepared: Option<&Path>) -> Result<()> {
    use std::{
        mem::size_of,
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    };
    use windows_sys::Win32::{
        System::Threading::*,
        UI::{Shell::*, WindowsAndMessaging::SW_HIDE},
    };
    let executable = std::env::current_exe().map_err(|_| ServiceError::Setup)?;
    let file = platform::wide(&executable.to_string_lossy());
    let verb = platform::wide("runas");
    // Both action and the app-created UUID file path are internal; Windows paths cannot contain quote characters.
    let parameters = platform::wide(&prepared.map_or_else(
        || action.to_owned(),
        |path| format!("{action} \"{}\"", path.display()),
    ));
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: verb.as_ptr(),
        lpFile: file.as_ptr(),
        lpParameters: parameters.as_ptr(),
        nShow: SW_HIDE,
        ..Default::default()
    };
    // SAFETY: the shell receives live NUL-terminated buffers and a fully initialized structure.
    if unsafe { ShellExecuteExW(&mut info) } == 0 || info.hProcess.is_null() {
        return Err(ServiceError::Denied);
    }
    // SAFETY: SEE_MASK_NOCLOSEPROCESS returned a new handle owned by the caller.
    let process = unsafe { OwnedHandle::from_raw_handle(info.hProcess) };
    let mut code = 1;
    // SAFETY: the process handle is live. Waiting occurs only on this blocking setup worker.
    unsafe {
        if WaitForSingleObject(process.as_raw_handle(), 180_000)
            != windows_sys::Win32::Foundation::WAIT_OBJECT_0
            || GetExitCodeProcess(process.as_raw_handle(), &mut code) == 0
        {
            return Err(ServiceError::Unavailable);
        }
    }
    if code == 0 {
        Ok(())
    } else if code == 2 {
        Err(ServiceError::RevocationPending)
    } else {
        Err(ServiceError::Setup)
    }
}
