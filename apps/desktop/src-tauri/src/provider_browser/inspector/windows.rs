//! WebView2 supplies a separate inspector HWND, but no docking API. Keep that real inspector
//! and reparent only the uniquely discovered window from this tab's explicit open operation.
mod device;
mod focus;
mod menu;
mod native;
mod user_agent;
#[cfg(test)]
pub(crate) use menu::fixture;

use super::{Action, BrowserError, Dock, Result, Status};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
    time::Duration,
};
use tauri::{Emitter, Manager, Webview};

struct Session {
    window: native::InspectorWindow,
    device: device::DeviceMode,
}

type Slot = Mutex<Option<Session>>;

#[derive(Default)]
struct State {
    opening: tokio::sync::Mutex<()>,
    windows: Mutex<HashMap<String, Weak<Slot>>>,
}

impl State {
    fn slot(&self, label: &str) -> Result<Arc<Slot>> {
        let mut windows = self.windows.lock().map_err(|_| BrowserError::Unavailable)?;
        if let Some(slot) = windows.get(label).and_then(Weak::upgrade) {
            return Ok(slot);
        }
        windows.retain(|_, slot| slot.strong_count() > 0);
        let slot = Arc::new(Mutex::new(None));
        windows.insert(label.into(), Arc::downgrade(&slot));
        Ok(slot)
    }
}

pub(in crate::provider_browser) fn install(
    core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    app: tauri::AppHandle,
    label: String,
) -> windows::core::Result<()> {
    app.manage(State::default());
    focus::install(controller)?;
    menu::install(core, controller, app, label)
}

fn notify(view: &Webview, status: Status) {
    if let Err(error) = view.emit_to(
        "main",
        "browser-inspector",
        serde_json::json!({
            "label":view.label(), "open":status.open, "mobile":status.mobile,
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

#[cfg(test)]
pub(super) async fn open_fixture(view: &Webview) -> Result<()> {
    open(view, None).await
}

async fn open(view: &Webview, discovery: Option<native::Discovery>) -> Result<()> {
    let state = view.state::<State>();
    let _opening = state.opening.lock().await;
    let browser = view.clone();
    let slot = state.slot(view.label())?;
    let opening = slot.clone();
    let created =
        tauri::async_runtime::spawn_blocking(move || acquire(&browser, discovery, &opening))
            .await
            .map_err(|_| BrowserError::Unavailable)??;
    if let Some(identity) = created {
        watch(view.clone(), slot, identity);
    }
    Ok(())
}

fn acquire(
    view: &Webview,
    discovery: Option<native::Discovery>,
    slot: &Slot,
) -> Result<Option<usize>> {
    let mut current = slot.lock().map_err(|_| BrowserError::Unavailable)?;
    if let Some(session) = current.as_mut() {
        if session.window.alive() {
            notify(
                view,
                Status {
                    open: true,
                    mobile: session.device.mobile(),
                },
            );
            return Ok(None);
        }
        session.device.update(view, None, None)?;
    }
    let window = native::InspectorWindow::open(view, discovery)?;
    let identity = window.identity();
    *current = Some(Session {
        window,
        device: Default::default(),
    });
    notify(
        view,
        Status {
            open: true,
            mobile: false,
        },
    );
    Ok(Some(identity))
}

pub(super) fn execute(view: &Webview, action: Action) -> Result<Status> {
    let Some(state) = view.try_state::<State>() else {
        return Ok(Status::default());
    };
    let slot = state.slot(view.label())?;
    let mut current = slot.lock().map_err(|_| BrowserError::Unavailable)?;
    let Some(session) = current.as_mut() else {
        return Ok(Status::default());
    };
    if !session.window.alive() || matches!(action, Action::Close) {
        session.device.update(view, None, None)?;
        session.window.close()?;
        *current = None;
        notify(view, Status::default());
        return Ok(Status::default());
    }
    match action {
        Action::Status | Action::Close => (),
        Action::SetMobile { enabled, name } => {
            session.device.update(view, enabled.then_some(name), None)?
        }
        Action::Place {
            dock,
            bounds,
            visible,
            viewport,
        } => {
            session.window.place(view, dock, bounds, visible)?;
            if let Some(viewport) = viewport.filter(|_| visible && session.device.mobile()) {
                session
                    .device
                    .update(view, Some(viewport.name), Some(viewport))?;
            }
        }
    }
    let status = Status {
        open: true,
        mobile: session.device.mobile(),
    };
    if matches!(action, Action::SetMobile { .. }) {
        notify(view, status);
    }
    Ok(status)
}

fn watch(view: Webview, slot: Arc<Slot>, identity: usize) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let browser = view.clone();
            let slot = slot.clone();
            let alive = tauri::async_runtime::spawn_blocking(move || {
                watch_status(&browser, &slot, identity)
            })
            .await;
            if !matches!(alive, Ok(Ok(true))) {
                if let Ok(Err(error)) = alive {
                    eprintln!("Browser inspector monitor failed: {error}");
                    continue;
                }
                break;
            }
        }
    });
}

fn watch_status(view: &Webview, slot: &Slot, identity: usize) -> Result<bool> {
    let mut current = slot.lock().map_err(|_| BrowserError::Unavailable)?;
    let Some(session) = current.as_mut() else {
        return Ok(false);
    };
    // A retired monitor must never close or report changes for a newly opened inspector.
    if session.window.identity() != identity {
        return Ok(false);
    }
    if view.app_handle().get_webview(view.label()).is_none() {
        session.window.close()?;
    } else if session.window.alive() {
        return Ok(true);
    } else {
        session.device.update(view, None, None)?;
    }
    *current = None;
    notify(view, Status::default());
    Ok(false)
}
