//! User-operated inspectors. Only the trusted main view can place a tab's inspector.
use super::{Bounds, BrowserError, Result, TabKind};
use serde::{Deserialize, Serialize};
use tauri::Webview;

#[cfg(test)]
pub(super) mod tests;
#[cfg(windows)]
pub(super) mod windows;

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Dock {
    Right,
    Bottom,
    Window,
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeviceViewport {
    width: u32,
    height: u32,
    scale: f64,
}

impl DeviceViewport {
    fn valid(self) -> bool {
        (50..=4096).contains(&self.width)
            && (50..=4096).contains(&self.height)
            && self.scale > 0.0
            && self.scale <= 1.0
    }
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Action {
    Status,
    Close,
    SetMobile {
        #[cfg_attr(not(windows), allow(dead_code))]
        enabled: bool,
    },
    Place {
        // Non-Windows hosts still deserialize the shared placement request.
        #[cfg_attr(not(windows), allow(dead_code))]
        dock: Dock,
        bounds: Bounds,
        viewport: Option<DeviceViewport>,
        #[cfg_attr(not(windows), allow(dead_code))]
        visible: bool,
    },
}

#[derive(Clone, Copy, Default, Serialize)]
pub(crate) struct Status {
    open: bool,
    mobile: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    id: uuid::Uuid,
    kind: TabKind,
    command: Action,
}

fn target(owner: &Webview, request: &Request) -> Result<Webview> {
    if let Action::Place {
        bounds, viewport, ..
    } = request.command
    {
        if !super::valid_bounds(bounds) || viewport.is_some_and(|size| !size.valid()) {
            return Err(BrowserError::Invalid);
        }
    }
    request.kind.child(owner, request.id)
}

#[tauri::command]
pub(crate) async fn browser_inspector(
    webview: Webview,
    request: Request,
) -> std::result::Result<Status, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let view = target(&webview, &request)?;
        #[cfg(windows)]
        return windows::execute(&view, request.command);
        #[cfg(not(windows))]
        {
            let _ = view;
            Ok::<_, BrowserError>(Status::default())
        }
    })
    .await
    .map_err(|_| BrowserError::Unavailable.to_string())?
    .map_err(|error| error.to_string())
}
