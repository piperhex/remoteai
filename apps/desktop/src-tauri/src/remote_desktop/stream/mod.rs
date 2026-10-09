//! Encoded desktop video stays in native WebRTC; only signaling and settings cross the WebView boundary.
#[cfg(windows)]
mod annex_b;
#[cfg(any(windows, target_os = "macos"))]
mod audio;
#[cfg(windows)]
mod audio_packet;
#[cfg(any(windows, target_os = "macos"))]
mod candidates;
#[cfg(any(windows, target_os = "macos"))]
mod capture_recovery;
#[cfg(any(windows, target_os = "macos"))]
mod direct;
#[cfg(windows)]
mod encoder;
#[cfg(target_os = "macos")]
#[path = "macos_encoder.rs"]
mod encoder;
#[cfg(any(windows, target_os = "macos"))]
mod feedback;
mod model;
#[cfg(any(windows, target_os = "macos"))]
mod native;
#[cfg(all(test, windows))]
mod native_test;
#[cfg(any(windows, target_os = "macos"))]
mod packets;
#[cfg(any(windows, target_os = "macos"))]
mod peer;
#[cfg(any(windows, target_os = "macos"))]
mod pump;
#[cfg(any(windows, target_os = "macos"))]
mod relay;
#[cfg(any(windows, target_os = "macos"))]
mod sample;
#[cfg(any(windows, target_os = "macos"))]
mod signaling;
#[cfg(all(test, windows))]
mod stack_test;
#[cfg(any(windows, target_os = "macos"))]
mod turn_transport;
use super::{safe_error, DesktopError};
pub(crate) use model::*;

#[cfg(any(windows, target_os = "macos"))]
const MAX_CANDIDATES: usize = 128;
#[cfg(any(windows, target_os = "macos"))]
static STREAM: tokio::sync::Mutex<Option<std::sync::Arc<native::Stream>>> =
    tokio::sync::Mutex::const_new(None);

#[cfg(any(windows, target_os = "macos"))]
async fn current(id: &str) -> super::Result<std::sync::Arc<native::Stream>> {
    STREAM
        .lock()
        .await
        .as_ref()
        .filter(|stream| stream.id == id)
        .cloned()
        .ok_or(DesktopError::Expired)
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_available(app: tauri::AppHandle) -> bool {
    #[cfg(any(windows, target_os = "macos"))]
    {
        use tauri::Manager;
        let Ok(directory) = app.path().resource_dir() else {
            return false;
        };
        tauri::async_runtime::spawn_blocking(move || encoder::runtime_path(directory).is_ok())
            .await
            .unwrap_or(false)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = app;
        false
    }
}

pub(super) async fn revoke() {
    #[cfg(any(windows, target_os = "macos"))]
    {
        let active = STREAM.lock().await.take();
        if let Some(stream) = active {
            stream.close().await;
        }
    }
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_open<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: OpenRequest,
) -> std::result::Result<Offer, String> {
    #[cfg(windows)]
    if crate::desktop_service::delegation::delegated(&request.id) {
        return crate::desktop_service::delegation::call(
            "remote_desktop_stream_open",
            &request.id,
            serde_json::json!({"request":&request}),
        )
        .await;
    }
    #[cfg(any(windows, target_os = "macos"))]
    {
        use tauri::Manager;
        let directory = app
            .path()
            .resource_dir()
            .map_err(|_| safe_error(DesktopError::Platform))?;
        open_at(directory, request).await
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, request);
        Err(safe_error(DesktopError::Unsupported))
    }
}

#[cfg(any(windows, target_os = "macos"))]
pub(super) async fn open_at(
    directory: std::path::PathBuf,
    request: OpenRequest,
) -> std::result::Result<Offer, String> {
    let id = request.id.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        super::with_lease(&id, |_| encoder::runtime_path(directory))
    })
    .await
    .map_err(|_| safe_error(DesktopError::Platform))?
    .map_err(safe_error)?;
    let mut active = STREAM.lock().await;
    if active
        .as_ref()
        .is_some_and(|stream| !*stream.cancel.borrow())
    {
        return Err(safe_error(DesktopError::Invalid));
    }
    let (stream, offer) = native::Stream::open(path, request)
        .await
        .map_err(safe_error)?;
    *active = Some(stream);
    Ok(offer)
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_signal(
    request: SignalRequest,
) -> std::result::Result<SignalReply, String> {
    #[cfg(windows)]
    if crate::desktop_service::delegation::delegated(&request.id) {
        return crate::desktop_service::delegation::call(
            "remote_desktop_stream_signal",
            &request.id,
            serde_json::json!({"request":&request}),
        )
        .await;
    }
    #[cfg(any(windows, target_os = "macos"))]
    {
        current(&request.id)
            .await
            .map_err(safe_error)?
            .signal(request)
            .await
            .map_err(safe_error)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = request;
        Err(safe_error(DesktopError::Unsupported))
    }
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_update(
    id: String,
    profile: Profile,
) -> std::result::Result<(), String> {
    #[cfg(windows)]
    if crate::desktop_service::delegation::delegated(&id) {
        return crate::desktop_service::delegation::call(
            "remote_desktop_stream_update",
            &id,
            serde_json::json!({"profile":profile}),
        )
        .await;
    }
    #[cfg(any(windows, target_os = "macos"))]
    {
        let profile = profile.validate().map_err(safe_error)?;
        let stream = current(&id).await.map_err(safe_error)?;
        if *stream.profile.borrow() != profile {
            stream.profile.send_replace(profile);
        }
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (id, profile);
        Err(safe_error(DesktopError::Unsupported))
    }
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_status(
    id: String,
) -> std::result::Result<StreamStats, String> {
    #[cfg(windows)]
    if crate::desktop_service::delegation::delegated(&id) {
        return crate::desktop_service::delegation::call(
            "remote_desktop_stream_status",
            &id,
            serde_json::json!({}),
        )
        .await;
    }
    #[cfg(any(windows, target_os = "macos"))]
    {
        Ok(current(&id)
            .await
            .map_err(safe_error)?
            .stats
            .lock()
            .await
            .clone())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = id;
        Err(safe_error(DesktopError::Unsupported))
    }
}

#[tauri::command]
pub(crate) async fn remote_desktop_stream_close(id: String) -> std::result::Result<(), String> {
    #[cfg(windows)]
    if crate::desktop_service::delegation::delegated(&id) {
        return crate::desktop_service::delegation::call(
            "remote_desktop_stream_close",
            &id,
            serde_json::json!({}),
        )
        .await;
    }
    #[cfg(any(windows, target_os = "macos"))]
    {
        let stream = {
            let mut active = STREAM.lock().await;
            if active.as_ref().is_some_and(|stream| stream.id == id) {
                active.take()
            } else {
                None
            }
        };
        if let Some(stream) = stream {
            stream.close().await;
        }
    }
    super::remote_desktop_close(id).await
}
