//! Unprivileged browser tabs hosted inside the Provider list window.
pub(crate) mod automation;
pub(crate) mod data;
#[cfg(windows)]
mod data_windows;
pub(crate) mod inspector;
mod lifecycle;
mod password_focus;
pub(crate) mod passwords;
mod platform;
pub(crate) mod preview;
pub(crate) mod vault_key;
pub(crate) use lifecycle::handle_page_load;
#[cfg(all(test, windows))]
mod data_smoke;
#[cfg(all(test, windows))]
mod smoke;

use serde::Deserialize;
use std::collections::BTreeMap;
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

#[derive(Debug, thiserror::Error)]
enum BrowserError {
    #[error("market.browserFailed")]
    Unavailable,
    #[error("market.invalid")]
    Invalid,
    #[cfg(not(windows))]
    #[error("market.browserHeadersUnsupported")]
    HeadersUnsupported,
}
type Result<T> = std::result::Result<T, BrowserError>;
const LABEL_PREFIX: &str = "provider-browser-";
const MAX_BROWSER_URL_BYTES: usize = 20 * 1024;
const MAX_PREVIEW_EXTENT: f64 = 32_768.0;

#[derive(Clone, Copy, Deserialize)]
pub(crate) struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BrowserRequest {
    id: String,
    url: String,
    header_origin: String,
    headers: BTreeMap<String, String>,
    bounds: Bounds,
    visible: bool,
    navigate: bool,
}

fn label(owner: &Webview, id: &str) -> Result<String> {
    if owner.label() != "main" {
        return Err(BrowserError::Invalid);
    }
    let id = uuid::Uuid::parse_str(id).map_err(|_| BrowserError::Invalid)?;
    Ok(format!("{LABEL_PREFIX}{id}"))
}

fn allowed_url(url: &url::Url, dev_origin: Option<&url::Origin>) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url
            .host_str()
            .is_some_and(|host| !matches!(host, "tauri.localhost" | "ipc.localhost"))
        && url.username().is_empty()
        && url.password().is_none()
        && dev_origin != Some(&url.origin())
}

fn validate_request(owner: &Webview, request: &BrowserRequest) -> Result<url::Url> {
    let url = url::Url::parse(&request.url).map_err(|_| BrowserError::Invalid)?;
    let dev_origin = owner
        .config()
        .build
        .dev_url
        .as_ref()
        .map(|url| url.origin());
    if !allowed_url(&url, dev_origin.as_ref()) || request.url.len() > MAX_BROWSER_URL_BYTES {
        return Err(BrowserError::Invalid);
    }
    crate::models::market_page::validate_page_headers(&request.headers)
        .map_err(|_| BrowserError::Invalid)?;
    if !request.headers.is_empty() {
        let origin = url::Url::parse(&request.header_origin).map_err(|_| BrowserError::Invalid)?;
        if !allowed_url(&origin, dev_origin.as_ref())
            || origin.origin().ascii_serialization() != request.header_origin
        {
            return Err(BrowserError::Invalid);
        }
    }
    Ok(url)
}

fn valid_bounds(bounds: Bounds) -> bool {
    [bounds.x, bounds.y, bounds.width, bounds.height]
        .iter()
        .all(|v| v.is_finite() && *v <= MAX_PREVIEW_EXTENT)
        && bounds.x >= 0.0
        && bounds.y >= 0.0
        && bounds.width > 0.0
        && bounds.height > 0.0
}

fn browser_builder(
    owner: &Webview,
    label: &str,
) -> Result<tauri::webview::WebviewBuilder<tauri::Wry>> {
    let app = owner.app_handle().clone();
    let event = label.to_string();
    let dev_origin = owner
        .config()
        .build
        .dev_url
        .as_ref()
        .map(|url| url.origin());
    // Start blank so header interception is installed before the first network request.
    let blank = url::Url::parse("about:blank").map_err(|_| BrowserError::Unavailable)?;
    let builder = crate::webview_windows::child_builder(
        owner.app_handle(),
        label,
        WebviewUrl::External(blank),
    )
    .data_directory(
        owner
            .app_handle()
            .path()
            .app_data_dir()
            .map_err(|_| BrowserError::Unavailable)?
            .join("browser-profile"),
    )
    .initialization_script(passwords::initialization())
    .initialization_script(include_str!("links.js"))
    .on_navigation(move |url| {
        let allowed = allowed_url(url, dev_origin.as_ref());
        if allowed {
            if let Err(error) = app.emit_to(
                "main",
                &event,
                serde_json::json!({"url":url.as_str(),"loading":true}),
            ) {
                eprintln!("Provider browser navigation notification failed: {error}");
            }
        }
        allowed || url.as_str() == "about:blank"
    })
    .on_download(|_, _| false);
    #[cfg(all(test, windows))]
    let builder = if owner.config().identifier == "dev.codex.switch.browser-data-smoke" {
        let args = owner
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .and_then(|window| window.additional_browser_args.as_deref())
            .unwrap_or_default();
        builder.additional_browser_args(&args.replace(
            "--remote-debugging-port=9355",
            "--remote-debugging-port=9356",
        ))
    } else {
        builder
    };
    // Windows handles popup events directly on the owning COM apartment; the handler only
    // notifies the frontend, leaving creation of the new tab to the command worker.
    #[cfg(not(windows))]
    let builder = popup_handler(owner, label, builder);
    Ok(builder)
}

#[cfg(not(windows))]
fn popup_handler(
    owner: &Webview,
    label: &str,
    builder: tauri::webview::WebviewBuilder<tauri::Wry>,
) -> tauri::webview::WebviewBuilder<tauri::Wry> {
    let app = owner.app_handle().clone();
    let event = label.to_string();
    let dev_origin = owner
        .config()
        .build
        .dev_url
        .as_ref()
        .map(|url| url.origin());
    builder.on_new_window(move |url, _| {
        if allowed_url(&url, dev_origin.as_ref()) {
            if let Err(error) = app.emit_to(
                "main",
                &event,
                serde_json::json!({"url":url.as_str(), "popup":true}),
            ) {
                eprintln!("Provider browser tab notification failed: {error}");
            }
        }
        tauri::webview::NewWindowResponse::Deny
    })
}

fn create(owner: &Webview, request: &BrowserRequest, label: &str) -> Result<Webview> {
    let builder = browser_builder(owner, label)?;
    let bounds = request.bounds;
    let view = owner
        .window()
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|_| BrowserError::Unavailable)?;
    if let Err(error) = platform::configure(&view, &request.header_origin, &request.headers) {
        if let Err(close_error) = view.close() {
            eprintln!("Provider browser cleanup failed: {close_error}");
        }
        return Err(error);
    }
    Ok(view)
}

fn sync(owner: &Webview, request: BrowserRequest) -> Result<()> {
    let label = label(owner, &request.id)?;
    let existing = owner.app_handle().get_webview(&label);
    if !request.visible {
        if let Some(view) = existing {
            view.hide().map_err(|_| BrowserError::Unavailable)?;
        }
        return Ok(());
    }
    let url = validate_request(owner, &request)?;
    if !valid_bounds(request.bounds) {
        return Err(BrowserError::Invalid);
    }
    let created = existing.is_none();
    let view = match existing {
        Some(view) => view,
        None => create(owner, &request, &label)?,
    };
    if created || request.navigate {
        view.navigate(url).map_err(|_| BrowserError::Unavailable)?;
    }
    let bounds = request.bounds;
    view.set_bounds(tauri::Rect {
        position: LogicalPosition::new(bounds.x, bounds.y).into(),
        size: LogicalSize::new(bounds.width, bounds.height).into(),
    })
    .map_err(|_| BrowserError::Unavailable)?;
    view.show().map_err(|_| BrowserError::Unavailable)
}

/// Native creation and synchronization run off the Windows UI thread.
#[tauri::command]
pub(crate) async fn provider_browser_sync(
    webview: Webview,
    request: BrowserRequest,
) -> std::result::Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sync(&webview, request))
        .await
        .map_err(|_| BrowserError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Action {
    Back,
    Forward,
    Reload,
    Stop,
}

#[tauri::command]
pub(crate) async fn provider_browser_action(
    webview: Webview,
    id: String,
    action: Action,
) -> std::result::Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let label = label(&webview, &id)?;
        let view = webview
            .app_handle()
            .get_webview(&label)
            .ok_or(BrowserError::Unavailable)?;
        if matches!(action, Action::Stop) {
            platform::stop(&view)?;
            lifecycle::notify_loading(&view, false);
            return Ok(());
        }
        let script = match action {
            Action::Back => "history.back()",
            Action::Forward => "history.forward()",
            Action::Reload => "location.reload()",
            Action::Stop => return Err(BrowserError::Invalid),
        };
        view.eval(script).map_err(|_| BrowserError::Unavailable)
    })
    .await
    .map_err(|_| BrowserError::Unavailable.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn provider_browser_close(
    webview: Webview,
    id: String,
) -> std::result::Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let label = label(&webview, &id)?;
        if let Some(view) = webview.app_handle().get_webview(&label) {
            view.close().map_err(|_| BrowserError::Unavailable)?;
        }
        Ok::<_, BrowserError>(())
    })
    .await
    .map_err(|_| BrowserError::Unavailable.to_string())?
    .map_err(|error| error.to_string())
}
