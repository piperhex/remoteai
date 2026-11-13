//! WebView2 supplies a separate inspector HWND, but no docking API. Keep that real inspector
//! and reparent only the uniquely discovered window from this tab's explicit open operation.
mod menu;
mod native;

use super::{Action, BrowserError, Dock, Result};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager, Webview};

#[derive(Default)]
struct State {
    opening: tokio::sync::Mutex<()>,
    windows: Mutex<HashMap<String, native::InspectorWindow>>,
}

pub(in crate::provider_browser) fn install(
    core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    app: tauri::AppHandle,
    label: String,
) -> windows::core::Result<()> {
    app.manage(State::default());
    menu::install(core, controller, app, label)
}

fn notify(view: &Webview, open: bool) {
    if let Err(error) = view.emit_to(
        "main",
        "browser-inspector",
        serde_json::json!({
            "label":view.label(), "open":open,
        }),
    ) {
        eprintln!("Browser inspector notification failed: {error}");
    }
}

fn launch(app: tauri::AppHandle, label: String, discovery: Option<native::Discovery>) {
    tauri::async_runtime::spawn(async move {
        let Some(view) = app.get_webview(&label) else {
            return;
        };
        if let Err(error) = open(&view, discovery).await {
            eprintln!("Browser inspector open failed: {error}");
            // Preserve access to the system inspector if an Evergreen change prevents docking.
            view.open_devtools();
        }
    });
}

async fn open(view: &Webview, discovery: Option<native::Discovery>) -> Result<()> {
    let state = view.state::<State>();
    let _opening = state.opening.lock().await;
    let browser = view.clone();
    let created = tauri::async_runtime::spawn_blocking(move || acquire(&browser, discovery))
        .await
        .map_err(|_| BrowserError::Unavailable)??;
    notify(view, true);
    if let Some(identity) = created {
        watch(view.clone(), identity);
    }
    Ok(())
}

fn acquire(view: &Webview, discovery: Option<native::Discovery>) -> Result<Option<usize>> {
    let state = view.state::<State>();
    let mut windows = state
        .windows
        .lock()
        .map_err(|_| BrowserError::Unavailable)?;
    if windows
        .get(view.label())
        .is_some_and(native::InspectorWindow::alive)
    {
        return Ok(None);
    }
    windows.remove(view.label());
    let window = native::InspectorWindow::open(view, discovery)?;
    let identity = window.identity();
    windows.insert(view.label().to_string(), window);
    Ok(Some(identity))
}

pub(super) fn execute(view: &Webview, action: Action) -> Result<bool> {
    let Some(state) = view.try_state::<State>() else {
        return Ok(false);
    };
    let mut windows = state
        .windows
        .lock()
        .map_err(|_| BrowserError::Unavailable)?;
    let Some(window) = windows.get_mut(view.label()) else {
        return Ok(false);
    };
    if !window.alive() {
        windows.remove(view.label());
        notify(view, false);
        return Ok(false);
    }
    match action {
        Action::Status => (),
        Action::Close => {
            window.close()?;
            windows.remove(view.label());
            notify(view, false);
            return Ok(false);
        }
        Action::Place {
            dock,
            bounds,
            visible,
        } => window.place(view, dock, bounds, visible)?,
    }
    Ok(true)
}

fn watch(view: Webview, identity: usize) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let browser = view.clone();
            let alive =
                tauri::async_runtime::spawn_blocking(move || watch_status(&browser, identity))
                    .await;
            if !matches!(alive, Ok(Ok(true))) {
                if let Ok(Err(error)) = alive {
                    eprintln!("Browser inspector monitor failed: {error}");
                }
                break;
            }
        }
    });
}

fn watch_status(view: &Webview, identity: usize) -> Result<bool> {
    let state = view.state::<State>();
    let mut windows = state
        .windows
        .lock()
        .map_err(|_| BrowserError::Unavailable)?;
    let Some(window) = windows.get(view.label()) else {
        return Ok(false);
    };
    // A retired monitor must never close or report changes for a newly opened inspector.
    if window.identity() != identity {
        return Ok(false);
    }
    if view.app_handle().get_webview(view.label()).is_none() {
        window.close()?;
    } else if window.alive() {
        return Ok(true);
    }
    windows.remove(view.label());
    notify(view, false);
    Ok(false)
}
