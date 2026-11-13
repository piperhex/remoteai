//! Conversation-owned browser automation. Remote pages never receive Tauri capabilities.
#[cfg(windows)]
mod devtools;
mod events;
pub(crate) mod finish;
mod page;
mod protocol;
mod registry;
mod screenshot;
#[cfg(test)]
mod tests;

pub(crate) use protocol::{Action, Request};
pub(crate) use registry::State;
pub(super) use screenshot::{capture_image, BrowserImage};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};

#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("market.browserInvalidUrl")]
    Invalid,
    #[error("market.browserFailed")]
    Unavailable,
    #[error("market.browserTabUnavailable")]
    Missing,
    #[error("market.browserStaleReference")]
    Stale,
    #[error("market.browserLimit")]
    Limit,
    #[cfg(not(windows))]
    #[error("market.browserCaptureUnsupported")]
    CaptureUnsupported,
}
pub(super) type Result<T> = std::result::Result<T, Error>;
const LABEL_PREFIX: &str = "conversation-browser-";

pub(super) fn hide_all(app: &AppHandle) {
    for (label, view) in app.webviews() {
        if label.starts_with(LABEL_PREFIX) {
            if let Err(error) = park(&view) {
                eprintln!("Browser preview hide failed: {error}");
            }
        }
    }
}

/// Keep remote previews rendering outside the host's visible bounds. WebView2 suspends screenshots
/// when IsVisible is false; parking retains the same page without covering another application view.
fn park(view: &Webview) -> Result<()> {
    view.set_bounds(tauri::Rect {
        position: tauri::LogicalPosition::new(-32_768.0, 0.0).into(),
        size: tauri::LogicalSize::new(1000.0, 700.0).into(),
    })
    .map_err(|_| Error::Unavailable)?;
    view.show().map_err(|_| Error::Unavailable)
}

fn url(app: &AppHandle, value: &str) -> Result<url::Url> {
    let parsed = url::Url::parse(value).map_err(|_| Error::Invalid)?;
    let origin = app.config().build.dev_url.as_ref().map(|url| url.origin());
    if value.len() > super::MAX_BROWSER_URL_BYTES || !super::allowed_url(&parsed, origin.as_ref()) {
        return Err(Error::Invalid);
    }
    Ok(parsed)
}

fn view(app: &AppHandle, id: &str) -> Result<Webview> {
    app.get_webview(&format!("{LABEL_PREFIX}{id}"))
        .ok_or(Error::Missing)
}

/// All native work is scheduled off the UI thread; each tab has an independent operation lock.
pub(crate) async fn execute(app: AppHandle, request: Request) -> Result<Value> {
    request.validate()?;
    let state = app.state::<State>();
    if matches!(request.action, Action::List) {
        return state.list(&request.thread_id);
    }
    if let Action::Open { url, request_id } = &request.action {
        return registry::open(&app, &request.thread_id, url, request_id).await;
    }
    let tab = state.get(
        &request.thread_id,
        request.tab_id.as_deref().ok_or(Error::Invalid)?,
    )?;
    let _operation = tab.operation.lock().await;
    let browser = view(&app, &tab.id)?;
    let value = match request.action {
        Action::Stop => {
            tauri::async_runtime::spawn_blocking(move || {
                super::platform::stop(&browser).map_err(|_| Error::Unavailable)?;
                super::lifecycle::notify_loading(&browser, false);
                Ok::<_, Error>(())
            })
            .await
            .map_err(|_| Error::Unavailable)??;
            json!({"stopped":true,"loading":false})
        }
        Action::Close => {
            close(&app, &tab).await?;
            json!({"closed":true,"tabId":tab.id})
        }
        Action::Screenshot => {
            let mut image = screenshot::capture(browser.clone()).await?;
            let address = tauri::async_runtime::spawn_blocking(move || browser.url())
                .await
                .map_err(|_| Error::Unavailable)?
                .map_err(|_| Error::Unavailable)?;
            image["url"] = json!(address.as_str());
            image["loading"] = json!(state.get(&tab.thread_id, &tab.id)?.loading);
            image
        }
        Action::Navigate { url: address } => {
            let address = url(&app, &address)?;
            tauri::async_runtime::spawn_blocking(move || browser.navigate(address))
                .await
                .map_err(|_| Error::Unavailable)?
                .map_err(|_| Error::Unavailable)?;
            json!({"tabId":tab.id,"navigating":true})
        }
        action => page::execute(&browser, &action).await?,
    };
    Ok(json!({"tabId":tab.id,"threadId":tab.thread_id,"result":value}))
}

/// The caller holds the tab's operation lock through native closure and registry cleanup.
async fn close(app: &AppHandle, tab: &registry::Tab) -> Result<()> {
    if let Some(browser) = app.get_webview(&format!("{LABEL_PREFIX}{}", tab.id)) {
        tauri::async_runtime::spawn_blocking(move || browser.close())
            .await
            .map_err(|_| Error::Unavailable)?
            .map_err(|_| Error::Unavailable)?;
    }
    app.state::<State>().remove(app, &tab.id)?;
    crate::codex_gui::web::publish(
        app,
        "codex-gui-event",
        json!({"method":"browser/closed", "params":{"threadId":tab.thread_id,"tabId":tab.id}}),
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn codex_gui_browser(
    app: AppHandle,
    request: Request,
) -> std::result::Result<Value, String> {
    execute(app, request)
        .await
        .map_err(|error| error.to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Placement {
    thread_id: String,
    tab_id: String,
    bounds: super::Bounds,
    visible: bool,
}

#[tauri::command]
pub(crate) async fn codex_gui_browser_place(
    webview: Webview,
    request: Placement,
) -> std::result::Result<(), String> {
    if webview.label() != "main" {
        return Err(Error::Invalid.to_string());
    }
    tauri::async_runtime::spawn_blocking(move || place(&webview, request))
        .await
        .map_err(|_| Error::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}

fn place(owner: &Webview, request: Placement) -> Result<()> {
    let app = owner.app_handle();
    app.state::<State>()
        .get(&request.thread_id, &request.tab_id)?;
    let browser = view(app, &request.tab_id)?;
    if !request.visible {
        return park(&browser);
    }
    if !super::valid_bounds(request.bounds) {
        return Err(Error::Invalid);
    }
    let bounds = request.bounds;
    browser
        .set_bounds(tauri::Rect {
            position: tauri::LogicalPosition::new(bounds.x, bounds.y).into(),
            size: tauri::LogicalSize::new(bounds.width, bounds.height).into(),
        })
        .map_err(|_| Error::Unavailable)?;
    browser.show().map_err(|_| Error::Unavailable)
}

fn opened(app: &AppHandle, thread_id: &str, tab: &registry::Tab) {
    let event = json!({"method":"browser/opened", "params":{"threadId":thread_id,"tab":tab}});
    crate::codex_gui::web::publish(app, "codex-gui-event", event);
}
