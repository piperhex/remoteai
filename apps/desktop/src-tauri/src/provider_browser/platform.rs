use super::{BrowserError, Result};
use std::collections::BTreeMap;

#[cfg(windows)]
mod windows;

pub(super) fn stop(view: &tauri::Webview) -> Result<()> {
    #[cfg(windows)]
    return windows::stop(view);
    #[cfg(not(windows))]
    view.eval("window.stop()")
        .map_err(|_| BrowserError::Unavailable)
}

pub(super) fn configure(
    view: &tauri::Webview,
    origin: &str,
    headers: &BTreeMap<String, String>,
    _mapping: Option<&super::mappings::BrowserMapping>,
) -> Result<()> {
    #[cfg(target_os = "macos")]
    if let Some(mapping) = _mapping {
        mapping.configure_view(view)?;
    }
    #[cfg(windows)]
    return windows::configure_headers(view, origin, headers, _mapping.is_some());
    #[cfg(not(windows))]
    configure_headers(view, origin, headers)
}

#[cfg(not(windows))]
fn configure_headers(
    _: &tauri::Webview,
    _: &str,
    headers: &BTreeMap<String, String>,
) -> Result<()> {
    if headers.is_empty() {
        Ok(())
    } else {
        Err(BrowserError::HeadersUnsupported)
    }
}
