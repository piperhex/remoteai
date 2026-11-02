use tauri::{
    webview::{PageLoadEvent, PageLoadPayload},
    Manager, Webview,
};

/// Reloads do not unmount React, so release the previous renderer's native tabs explicitly.
pub(crate) fn handle_page_load(webview: &Webview, payload: &PageLoadPayload<'_>) {
    if webview.label() != "main" || !matches!(payload.event(), PageLoadEvent::Started) {
        return;
    }
    let app = webview.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        super::automation::hide_all(&app);
        for (label, view) in app.webviews() {
            if label.starts_with(super::LABEL_PREFIX) {
                if let Err(error) = view.close() {
                    eprintln!("Provider browser cleanup failed: {error}");
                }
            }
        }
    });
}
