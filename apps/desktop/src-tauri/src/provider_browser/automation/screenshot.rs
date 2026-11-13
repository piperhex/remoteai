use super::{Error, Result};
use serde_json::Value;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserImage {
    mime_type: &'static str,
    data: String,
}

pub(super) async fn capture(view: tauri::Webview) -> Result<Value> {
    Ok(serde_json::json!({"image": capture_image(view).await?}))
}

#[cfg(not(windows))]
pub(in crate::provider_browser) async fn capture_image(_: tauri::Webview) -> Result<BrowserImage> {
    Err(Error::CaptureUnsupported)
}

#[cfg(windows)]
pub(in crate::provider_browser) async fn capture_image(
    view: tauri::Webview,
) -> Result<BrowserImage> {
    let response = super::devtools::capture(&view).await?;
    let data = response["data"]
        .as_str()
        .filter(|data| data.len() <= 2_000_000)
        .ok_or(Error::Unavailable)?;
    Ok(BrowserImage {
        mime_type: "image/jpeg",
        data: data.to_owned(),
    })
}
