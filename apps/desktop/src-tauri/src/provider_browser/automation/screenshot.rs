use super::{Error, Result};
use serde_json::Value;

#[cfg(not(windows))]
pub(super) async fn capture(_: tauri::Webview) -> Result<Value> {
    Err(Error::CaptureUnsupported)
}

#[cfg(windows)]
pub(super) async fn capture(view: tauri::Webview) -> Result<Value> {
    let response = super::devtools::capture(&view).await?;
    let data = response["data"]
        .as_str()
        .filter(|data| data.len() <= 2_000_000)
        .ok_or(Error::Unavailable)?;
    Ok(serde_json::json!({"image":{"mimeType":"image/jpeg","data":data}}))
}
