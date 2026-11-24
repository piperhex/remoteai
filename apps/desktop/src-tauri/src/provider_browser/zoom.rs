use super::{BrowserError, TabKind};
use tauri::{Emitter, Webview};

/// Only the app's toolbar may set the page zoom of a browser child.
#[tauri::command]
pub(crate) async fn browser_set_zoom(
    webview: Webview,
    kind: TabKind,
    id: uuid::Uuid,
    percent: u16,
) -> Result<(), String> {
    if !(25..=500).contains(&percent) {
        return Err(BrowserError::Invalid.to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        kind.child(&webview, id)?
            .set_zoom(f64::from(percent) / 100.0)
            .map_err(|_| BrowserError::Unavailable)
    })
    .await
    .map_err(|_| BrowserError::Unavailable.to_string())?
    .map_err(|error| error.to_string())
}

#[cfg(windows)]
pub(super) fn install(
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    app: tauri::AppHandle,
    label: String,
) -> windows::core::Result<()> {
    use webview2_com::ZoomFactorChangedEventHandler;
    // SAFETY: Browser setup and the retained callback run on the controller's COM apartment.
    unsafe {
        controller
            .CoreWebView2()?
            .Settings()?
            .SetIsZoomControlEnabled(true)?;
        controller.add_ZoomFactorChanged(
            &ZoomFactorChangedEventHandler::create(Box::new(move |sender, _| {
                if let Some(sender) = sender {
                    let mut factor = 1.0;
                    sender.ZoomFactor(&mut factor)?;
                    if let Err(error) = app.emit_to(
                        "main",
                        &label,
                        serde_json::json!({"zoomPercent": (factor * 100.0).round() as u16}),
                    ) {
                        eprintln!("Browser zoom notification failed: {error}");
                    }
                }
                Ok(())
            })),
            &mut 0,
        )
    }
}

#[cfg(not(windows))]
pub(super) fn handle_wheel(app: &tauri::AppHandle, label: &str, url: &url::Url) -> bool {
    let direction = match url.as_str() {
        "remoteai-browser-zoom:in" => 1,
        "remoteai-browser-zoom:out" => -1,
        _ => return false,
    };
    if let Err(error) = app.emit_to("main", label, serde_json::json!({"zoomStep": direction})) {
        eprintln!("Browser zoom notification failed: {error}");
    }
    true
}
