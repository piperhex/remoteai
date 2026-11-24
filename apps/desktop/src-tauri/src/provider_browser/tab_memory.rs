//! Read the hovered tab's JavaScript heap without activating it or enabling a profiler.
use super::{BrowserError, TabKind};
use tauri::Webview;

#[tauri::command]
pub(crate) async fn browser_tab_memory(
    webview: Webview,
    id: uuid::Uuid,
    kind: TabKind,
) -> Result<Option<f64>, String> {
    let child = tauri::async_runtime::spawn_blocking(move || kind.child(&webview, id))
        .await
        .map_err(|_| BrowserError::Unavailable.to_string())?
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    {
        let metrics = super::automation::devtools::call(
            &child,
            "Runtime.getHeapUsage",
            serde_json::json!({}),
        )
        .await
        .map_err(|_| BrowserError::Unavailable.to_string())?;
        Ok(metrics["usedSize"]
            .as_f64()
            .filter(|bytes| bytes.is_finite() && *bytes >= 0.0))
    }
    #[cfg(not(windows))]
    {
        drop(child);
        Ok(None)
    }
}
