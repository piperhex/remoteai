use super::{BrowserError, Result};
use crate::provider_browser::automation::devtools;
use crate::provider_browser::inspector::DeviceViewport;
use serde_json::{json, Value};
use tauri::Webview;

#[derive(Default)]
pub(super) struct DeviceMode {
    pub(super) mobile: bool,
    needs_restore: bool,
    viewport: Option<DeviceViewport>,
}

impl DeviceMode {
    pub(super) fn resize(&mut self, view: &Webview, viewport: DeviceViewport) -> Result<()> {
        if self.viewport != Some(viewport) {
            tauri::async_runtime::block_on(metrics(view, Some(viewport)))?;
            self.viewport = Some(viewport);
        }
        Ok(())
    }

    /// Called on a blocking worker under this tab's session lock, including on native close.
    pub(super) fn set(&mut self, view: &Webview, enabled: bool) -> Result<()> {
        if self.mobile == enabled && !self.needs_restore {
            return Ok(());
        }
        let previous = self.mobile;
        self.needs_restore = true;
        if let Err(error) = tauri::async_runtime::block_on(apply(view, enabled, None)) {
            if tauri::async_runtime::block_on(apply(view, previous, self.viewport)).is_ok() {
                self.needs_restore = false;
            }
            return Err(error);
        }
        self.mobile = enabled;
        self.viewport = None;
        self.needs_restore = false;
        Ok(())
    }
}

async fn metrics(view: &Webview, viewport: Option<DeviceViewport>) -> Result<()> {
    let (width, height, scale) = viewport.map_or((0, 0, 1.0), |v| (v.width, v.height, v.scale));
    call(
        view,
        "Emulation.setDeviceMetricsOverride",
        json!({
            "mobile": true, "width": width, "height": height, "deviceScaleFactor": 0,
            "scale": scale, "dontSetVisibleSize": true
        }),
    )
    .await
}

async fn apply(view: &Webview, mobile: bool, viewport: Option<DeviceViewport>) -> Result<()> {
    if mobile {
        metrics(view, viewport).await?;
    } else {
        call(view, "Emulation.clearDeviceMetricsOverride", json!({})).await?;
    }
    call(
        view,
        "Emulation.setTouchEmulationEnabled",
        json!({ "enabled": mobile }),
    )
    .await?;
    call(
        view,
        "Emulation.setEmitTouchEventsForMouse",
        json!({
            "enabled": mobile, "configuration": "mobile"
        }),
    )
    .await
}

async fn call(view: &Webview, method: &'static str, parameters: Value) -> Result<()> {
    let reply = devtools::call(view, method, parameters)
        .await
        .map_err(|_| BrowserError::Unavailable)?;
    if reply.get("error").is_some() {
        return Err(BrowserError::Unavailable);
    }
    Ok(())
}
