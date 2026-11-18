use super::{BrowserError, Result};
use crate::provider_browser::automation::devtools;
use serde_json::{json, Value};
use tauri::Webview;

#[derive(Default)]
pub(super) struct DeviceMode {
    pub(super) mobile: bool,
    needs_restore: bool,
}

impl DeviceMode {
    /// Called on a blocking worker under this tab's session lock, including on native close.
    pub(super) fn set(&mut self, view: &Webview, enabled: bool) -> Result<()> {
        if self.mobile == enabled && !self.needs_restore {
            return Ok(());
        }
        let previous = self.mobile;
        self.needs_restore = true;
        if let Err(error) = tauri::async_runtime::block_on(apply(view, enabled)) {
            if tauri::async_runtime::block_on(apply(view, previous)).is_ok() {
                self.needs_restore = false;
            }
            return Err(error);
        }
        self.mobile = enabled;
        self.needs_restore = false;
        Ok(())
    }
}

async fn apply(view: &Webview, mobile: bool) -> Result<()> {
    // The shared surface sizes the actual controller. Zero dimensions track its bounds on resize.
    let (method, metrics) = if mobile {
        (
            "Emulation.setDeviceMetricsOverride",
            json!({
                "mobile": true, "width": 0, "height": 0, "deviceScaleFactor": 0
            }),
        )
    } else {
        ("Emulation.clearDeviceMetricsOverride", json!({}))
    };
    call(view, method, metrics).await?;
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
