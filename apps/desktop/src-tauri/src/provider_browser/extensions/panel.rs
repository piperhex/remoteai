//! Extension pages retain their unprivileged browser profile while docked beside the current page.
mod input;
use super::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};

const PREFIX: &str = "browser-panel-";
const MAX_PANELS: usize = 8;
const PARK_X: f64 = -32_768.0;
const CHAT_URL: &str = "https://codex.onepiper.cloud/web/";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Command {
    Open { extension: Option<String> },
    Close,
    Reload,
    Capture,
    Resize { width: f64, height: f64 },
    Click { x: f64, y: f64 },
    Text { text: String },
    Key { key: String },
    Scroll { x: f64, y: f64, delta: f64 },
}

fn label(session: &str) -> Result<String> {
    let id = uuid::Uuid::parse_str(session).map_err(|_| Error::Invalid)?;
    Ok(format!("{PREFIX}{id}"))
}

fn view(app: &AppHandle, session: &str) -> Result<Webview> {
    app.get_webview(&label(session)?).ok_or(Error::Missing)
}

pub(crate) async fn execute(app: AppHandle, session: String, command: Command) -> Result<Value> {
    label(&session)?;
    // Serialize input, captures and teardown. No synchronous lock is held on the UI thread.
    static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = SERIAL.lock().await;
    if let Command::Capture = command {
        let browser = view(&app, &session)?;
        let image = super::super::automation::capture_image(browser)
            .await
            .map_err(|_| Error::Engine)?;
        return Ok(json!({"result": {"image": image}}));
    }
    if matches!(
        command,
        Command::Click { .. } | Command::Text { .. } | Command::Key { .. } | Command::Scroll { .. }
    ) {
        return input::execute(&view(&app, &session)?, command).await;
    }
    tauri::async_runtime::spawn_blocking(move || perform(&app, &session, command))
        .await
        .map_err(|_| Error::Engine)?
}

fn perform(app: &AppHandle, session: &str, command: Command) -> Result<Value> {
    match command {
        Command::Open { extension } => open(app, session, extension.as_deref())?,
        Command::Close => {
            if let Some(browser) = app.get_webview(&label(session)?) {
                browser.close().map_err(|_| Error::Engine)?;
            }
        }
        Command::Reload => view(app, session)?
            .eval("location.reload()")
            .map_err(|_| Error::Engine)?,
        Command::Resize { width, height } => {
            let bounds = super::super::Bounds {
                x: 0.0,
                y: 0.0,
                width,
                height,
            };
            if !super::super::valid_bounds(bounds) || width > 4096.0 || height > 4096.0 {
                return Err(Error::Invalid);
            }
            view(app, session)?
                .set_size(tauri::LogicalSize::new(width, height))
                .map_err(|_| Error::Engine)?;
        }
        _ => return Err(Error::Invalid),
    }
    Ok(json!({}))
}

fn address(app: &AppHandle, extension: Option<&str>) -> Result<url::Url> {
    let Some(id) = extension else {
        #[cfg(debug_assertions)]
        if let Ok(value) = std::env::var("CSW_BROWSER_PANEL_TEST_URL") {
            let url = url::Url::parse(&value).map_err(|_| Error::Invalid)?;
            if url.scheme() == "http" && url.host_str() == Some("127.0.0.1") {
                return Ok(url);
            }
            return Err(Error::Invalid);
        }
        return url::Url::parse(CHAT_URL).map_err(|_| Error::Invalid);
    };
    #[cfg(windows)]
    {
        let catalog = super::read(&super::root(app)?)?;
        let record = catalog
            .entries
            .iter()
            .find(|record| record.id == id)
            .ok_or(Error::Missing)?;
        let path = record.manifest.side_panel.as_ref().ok_or(Error::Missing)?;
        // Recheck the immutable package and live enabled state, including for a restored panel.
        super::manifest::child(&super::root(app)?.join(&record.directory), path)?;
        if !super::windows::execute(&super::manager(app)?, super::windows::Operation::List)?
            .iter()
            .any(|entry| entry.id == id && entry.enabled)
        {
            return Err(Error::Missing);
        }
        url::Url::parse(&format!("chrome-extension://{id}/{path}")).map_err(|_| Error::Invalid)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, id);
        Err(Error::Unsupported)
    }
}

fn open(app: &AppHandle, session: &str, extension: Option<&str>) -> Result<()> {
    let address = address(app, extension)?;
    let label = label(session)?;
    if let Some(browser) = app.get_webview(&label) {
        if browser.url().map_err(|_| Error::Engine)?.origin() != address.origin() {
            return Err(Error::Invalid);
        }
        return Ok(());
    }
    if app
        .webviews()
        .keys()
        .filter(|label| label.starts_with(PREFIX))
        .count()
        >= MAX_PANELS
    {
        return Err(Error::Engine);
    }
    let owner = app.get_webview("main").ok_or(Error::Engine)?;
    let extension = extension.map(str::to_owned);
    let origin = address.origin();
    let builder =
        crate::webview_windows::child_builder(app, &label, tauri::WebviewUrl::External(address))
            .data_directory(
                app.path()
                    .app_data_dir()
                    .map_err(|_| Error::Storage)?
                    .join("browser-profile"),
            )
            .general_autofill_enabled(false)
            .browser_extensions_enabled(true)
            .on_navigation(move |url| match &extension {
                Some(id) => url.scheme() == "chrome-extension" && url.host_str() == Some(id),
                None => url.origin() == origin,
            })
            .on_download(|_, _| false);
    owner
        .window()
        .add_child(
            builder,
            tauri::LogicalPosition::new(PARK_X, 0.0),
            tauri::LogicalSize::new(380.0, 700.0),
        )
        .map_err(|_| Error::Engine)?;
    Ok(())
}

#[cfg(windows)]
pub(super) fn close_extension(app: &AppHandle, id: &str) -> Result<()> {
    for (label, browser) in app.webviews() {
        if label.starts_with(PREFIX) {
            let address = browser.url().map_err(|_| Error::Engine)?;
            if address.scheme() == "chrome-extension" && address.host_str() == Some(id) {
                browser.close().map_err(|_| Error::Engine)?;
            }
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Placement {
    session: String,
    bounds: super::super::Bounds,
    visible: bool,
}

#[tauri::command]
pub(crate) async fn browser_extension_panel_place(
    webview: Webview,
    request: Placement,
) -> std::result::Result<(), String> {
    if webview.label() != "main" {
        return Err(Error::Invalid.to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let browser = view(webview.app_handle(), &request.session)?;
        let bounds = request.bounds;
        if !super::super::valid_bounds(bounds) {
            return Err(Error::Invalid);
        }
        browser
            .set_bounds(tauri::Rect {
                position: tauri::LogicalPosition::new(
                    if request.visible { bounds.x } else { PARK_X },
                    bounds.y,
                )
                .into(),
                size: tauri::LogicalSize::new(bounds.width, bounds.height).into(),
            })
            .map_err(|_| Error::Engine)?;
        browser.show().map_err(|_| Error::Engine)
    })
    .await
    .map_err(|_| Error::Engine.to_string())?
    .map_err(|error| error.to_string())
}
