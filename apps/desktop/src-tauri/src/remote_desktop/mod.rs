//! Screen capture and input run on blocking workers, never the Windows UI thread.
use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub(crate) mod clipboard;
mod clipboard_files;
mod clipboard_platform;
pub(crate) mod displays;
#[cfg(windows)]
pub(crate) mod input_desktop;
mod keyboard;
mod lease;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "macos", test))]
mod macos_keymap;
#[cfg(target_os = "macos")]
use macos::{input as platform_input, monitors};
#[cfg(windows)]
use windows_input as platform_input;
pub(crate) mod local_clipboard;
#[cfg(windows)]
mod monitors;
pub(crate) mod permissions;
#[cfg(windows)]
pub(crate) mod service_worker;
pub(crate) mod stream;
pub(crate) mod system_permissions;
mod validation;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
mod windows_input;

#[derive(Debug, thiserror::Error)]
pub(super) enum DesktopError {
    #[cfg(any(windows, target_os = "macos"))]
    #[error("desktop session already active")]
    Busy,
    #[error("desktop permission denied")]
    Denied,
    #[error("invalid desktop request")]
    Invalid,
    #[error("desktop session expired")]
    Expired,
    #[error("desktop capture or input failed")]
    Platform,
    #[cfg(any(windows, target_os = "macos"))]
    #[error("selected desktop display disconnected")]
    DisplayGone,
    #[error("desktop platform unsupported")]
    #[cfg(not(any(windows, target_os = "macos")))]
    Unsupported,
    #[cfg(target_os = "macos")]
    #[error("macOS 13 or later required")]
    MacVersion,
    #[cfg(target_os = "macos")]
    #[error("screen recording permission required")]
    ScreenPermission,
    #[cfg(target_os = "macos")]
    #[error("accessibility permission required")]
    InputPermission,
}
type Result<T> = std::result::Result<T, DesktopError>;
const LEASE: Duration = Duration::from_secs(15);
struct Session {
    permissions: permissions::Permissions,
    id: String,
    touched: Instant,
    deadline: Instant,
    clipboard: Option<clipboard::Transfer>,
    #[cfg(any(windows, target_os = "macos"))]
    display: monitors::Monitor,
    #[cfg(any(windows, target_os = "macos"))]
    input: platform_input::InputState,
}
static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(
    not(any(windows, target_os = "macos")),
    expect(
        dead_code,
        reason = "Keep the IPC input schema on platforms without a desktop host."
    )
)]
pub(crate) enum DesktopInput {
    Move {
        x: f64,
        y: f64,
    },
    Button {
        button: Button,
        down: bool,
    },
    Wheel {
        delta: i32,
        #[serde(default)]
        horizontal: bool,
    },
    Text {
        text: String,
    },
    Key {
        key: Key,
    },
    Keyboard {
        code: keyboard::KeyboardKey,
        down: bool,
    },
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Button {
    Left,
    Right,
    Middle,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Key {
    Enter,
    Backspace,
    Escape,
    Tab,
    Desktop,
    Windows,
}

fn safe_error(error: DesktopError) -> String {
    match error {
        #[cfg(any(windows, target_os = "macos"))]
        DesktopError::Busy => "已有远程桌面连接，请先关闭后再试。",
        DesktopError::Denied => "这台电脑未允许此远程操作，请在电脑的设置中调整。",
        #[cfg(not(any(windows, target_os = "macos")))]
        DesktopError::Unsupported => "这台电脑暂不支持远程桌面，请使用 Windows 或 Mac 电脑。",
        #[cfg(target_os = "macos")]
        DesktopError::MacVersion => "远程桌面需要 macOS 13 或更新版本。",
        #[cfg(target_os = "macos")]
        DesktopError::ScreenPermission => "请在 Mac 的远程设置中开启屏幕录制权限，然后重新连接。",
        #[cfg(target_os = "macos")]
        DesktopError::InputPermission => "请在 Mac 的远程设置中开启辅助功能权限，然后重新连接。",
        DesktopError::Expired => "桌面连接已结束，请重新连接。",
        DesktopError::Invalid => "远程操作无效，请重试。",
        DesktopError::Platform => "暂时无法访问桌面，请稍后重试。",
        #[cfg(any(windows, target_os = "macos"))]
        DesktopError::DisplayGone => "显示器已断开，请重新连接桌面。",
    }
    .into()
}

fn with_session<T>(id: &str, operation: impl FnOnce(&mut Session) -> Result<T>) -> Result<T> {
    with_lease(id, |session| {
        #[cfg(windows)]
        let _desktop = input_desktop::InputDesktop::enter()?;
        operation(session)
    })
}

// Heartbeat/authorization checks must not depend on an input desktop being available during a lock transition.
fn with_lease<T>(id: &str, operation: impl FnOnce(&mut Session) -> Result<T>) -> Result<T> {
    let mut guard = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| DesktopError::Platform)?;
    let session = guard
        .as_mut()
        .filter(|session| session.id == id)
        .ok_or(DesktopError::Expired)?;
    if session.touched.elapsed() > LEASE || Instant::now() >= session.deadline {
        return Err(DesktopError::Expired);
    }
    session.touched = Instant::now();
    operation(session)
}

fn open(
    display_id: Option<String>,
    permissions: permissions::Permissions,
    expires_at: Option<u64>,
) -> Result<displays::Opened> {
    #[cfg(windows)]
    let _desktop = input_desktop::InputDesktop::enter()?;
    if !permissions.enabled {
        return Err(DesktopError::Denied);
    }
    #[cfg(target_os = "macos")]
    macos::authorize(permissions.control)?;
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (display_id, expires_at);
        Err(DesktopError::Unsupported)
    }
    #[cfg(any(windows, target_os = "macos"))]
    {
        if display_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 128)
        {
            return Err(DesktopError::Invalid);
        }
        let monitors = monitors::list()?;
        let display = monitors::select(&monitors, display_id.as_deref())?;
        let display_id = display.info.id.clone();
        let id = begin_session(display, permissions, expires_at)?;
        Ok(displays::Opened {
            platform: Some(if cfg!(target_os = "macos") {
                displays::HostPlatform::Macos
            } else {
                displays::HostPlatform::Windows
            }),
            native_only: cfg!(target_os = "macos"),
            permissions,
            id,
            display_id,
            displays: monitors.into_iter().map(|monitor| monitor.info).collect(),
        })
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn begin_session(
    display: monitors::Monitor,
    permissions: permissions::Permissions,
    expires_at: Option<u64>,
) -> Result<String> {
    let deadline = lease::deadline(expires_at)?;
    let mut guard = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| DesktopError::Platform)?;
    if let Some(session) = guard.as_mut() {
        if session.touched.elapsed() <= LEASE && Instant::now() < session.deadline {
            return Err(DesktopError::Busy);
        }
        session.input.release()?;
    }
    let id = uuid::Uuid::new_v4().to_string();
    *guard = Some(Session {
        permissions,
        id: id.clone(),
        touched: Instant::now(),
        deadline,
        clipboard: None,
        display,
        input: platform_input::InputState::default(),
    });
    let watched = id.clone();
    std::thread::spawn(move || expire(watched));
    Ok(id)
}

#[cfg(any(windows, target_os = "macos"))]
fn expire(id: String) {
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let Ok(mut guard) = SESSION.get_or_init(|| Mutex::new(None)).lock() else {
            return;
        };
        let Some(session) = guard.as_mut().filter(|session| session.id == id) else {
            return;
        };
        if session.touched.elapsed() <= LEASE && Instant::now() < session.deadline {
            continue;
        }
        #[cfg(windows)]
        let _desktop = match input_desktop::InputDesktop::enter() {
            Ok(desktop) => Some(desktop),
            Err(error) => {
                eprintln!("desktop cleanup context: {error}");
                None
            }
        };
        if let Err(error) = session.input.release() {
            eprintln!("desktop input cleanup: {error}");
        }
        *guard = None;
        return;
    }
}

fn revoke() -> Result<()> {
    #[cfg(windows)]
    let _desktop = input_desktop::InputDesktop::enter()?;
    let mut guard = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| DesktopError::Platform)?;
    #[cfg(any(windows, target_os = "macos"))]
    if let Some(session) = guard.as_mut() {
        session.input.release()?;
    }
    *guard = None;
    Ok(())
}

fn close(id: &str) -> Result<()> {
    #[cfg(windows)]
    let _desktop = input_desktop::InputDesktop::enter()?;
    let mut guard = SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| DesktopError::Platform)?;
    if let Some(_session) = guard.as_mut().filter(|session| session.id == id) {
        #[cfg(any(windows, target_os = "macos"))]
        _session.input.release()?;
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn remote_desktop_open(
    app: tauri::AppHandle,
    display_id: Option<String>,
    expires_at: Option<u64>,
) -> std::result::Result<displays::Opened, String> {
    #[cfg(windows)]
    if let Some(opened) =
        crate::desktop_service::delegation::open(display_id.clone(), expires_at).await?
    {
        return Ok(opened);
    }
    tauri::async_runtime::spawn_blocking(move || permissions::open(&app, display_id, expires_at))
        .await
        .map_err(|_| safe_error(DesktopError::Platform))?
        .map_err(safe_error)
}

#[tauri::command]
pub(crate) async fn remote_desktop_renew(
    id: String,
    expires_at: u64,
) -> std::result::Result<(), String> {
    #[cfg(windows)]
    if crate::desktop_service::delegation::delegated(&id) {
        return crate::desktop_service::delegation::call(
            "remote_desktop_renew",
            &id,
            serde_json::json!({"expiresAt": expires_at}),
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&id, |session| {
            session.deadline = lease::deadline(Some(expires_at))?;
            Ok(())
        })
    })
    .await
    .map_err(|_| safe_error(DesktopError::Platform))?
    .map_err(safe_error)
}

#[tauri::command]
pub(crate) async fn remote_desktop_frame(
    id: String,
    width: u32,
) -> std::result::Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validation::width(width)?;
        #[cfg(windows)]
        return with_session(&id, |session| windows::capture(width, &session.display))
            .map(tauri::ipc::Response::new);
        #[cfg(target_os = "macos")]
        {
            // macOS uses ScreenCaptureKit and the native H.264 stream, never legacy JPEG capture.
            let _ = id;
            Err(DesktopError::Platform)
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = id;
            Err(DesktopError::Unsupported)
        }
    })
    .await
    .map_err(|_| safe_error(DesktopError::Platform))?
    .map_err(safe_error)
}

#[tauri::command]
pub(crate) async fn remote_desktop_input(
    id: String,
    input: DesktopInput,
) -> std::result::Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validation::input(&input)?;
        with_session(&id, |session| {
            if !session.permissions.control {
                return Err(DesktopError::Denied);
            }
            #[cfg(any(windows, target_os = "macos"))]
            return session.input.apply(input, &session.display);
            #[cfg(not(any(windows, target_os = "macos")))]
            Err(DesktopError::Unsupported)
        })
    })
    .await
    .map_err(|_| safe_error(DesktopError::Platform))?
    .map_err(safe_error)
}

#[tauri::command]
pub(crate) async fn remote_desktop_close(id: String) -> std::result::Result<(), String> {
    #[cfg(windows)]
    if crate::desktop_service::delegation::delegated(&id) {
        return crate::desktop_service::delegation::call(
            "remote_desktop_close",
            &id,
            serde_json::json!({}),
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || close(&id))
        .await
        .map_err(|_| safe_error(DesktopError::Platform))?
        .map_err(safe_error)
}
