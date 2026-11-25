use super::{BrowserError, Result};
use crate::provider_browser::automation::devtools;
use crate::provider_browser::inspector::{DevicePreset, DeviceViewport};
use serde_json::{json, Value};
use tauri::Webview;

#[derive(Clone, Copy, Default)]
struct Settings {
    preset: Option<DevicePreset>,
    viewport: Option<DeviceViewport>,
}

#[derive(Default)]
pub(super) struct DeviceMode {
    applied: Settings,
    needs_restore: bool,
    chrome_version: Option<String>,
}

impl DeviceMode {
    pub(super) fn mobile(&self) -> bool {
        self.applied.preset.is_some()
    }

    /// Called on a blocking worker under this tab's session lock, including on native close.
    pub(super) fn update(
        &mut self,
        view: &Webview,
        preset: Option<DevicePreset>,
        viewport: Option<DeviceViewport>,
    ) -> Result<()> {
        let next = Settings { preset, viewport };
        if let Err(error) =
            tauri::async_runtime::block_on(self.apply(view, next, self.needs_restore))
        {
            self.needs_restore =
                tauri::async_runtime::block_on(self.apply(view, self.applied, true)).is_err();
            return Err(error);
        }
        self.applied = next;
        self.needs_restore = false;
        Ok(())
    }

    async fn apply(&mut self, view: &Webview, next: Settings, force: bool) -> Result<()> {
        let mobile = next.preset.is_some();
        if force || next.preset != self.applied.preset {
            let params =
                super::user_agent::parameters(view, next.preset, &mut self.chrome_version).await?;
            call(view, "Emulation.setUserAgentOverride", params).await?;
        }
        if force || self.mobile() != mobile || self.applied.viewport != next.viewport {
            if mobile {
                metrics(view, next.viewport).await?;
            } else {
                call(view, "Emulation.clearDeviceMetricsOverride", json!({})).await?;
            }
        }
        if force || self.mobile() != mobile {
            touch(view, mobile).await?;
        }
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

async fn touch(view: &Webview, mobile: bool) -> Result<()> {
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
