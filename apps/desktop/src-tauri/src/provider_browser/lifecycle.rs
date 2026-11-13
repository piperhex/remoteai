use tauri::{
    webview::{PageLoadEvent, PageLoadPayload},
    Emitter, Manager, Webview,
};

/// Reloads do not unmount React, so release the previous renderer's native tabs explicitly.
pub(crate) fn handle_page_load(webview: &Webview, payload: &PageLoadPayload<'_>) {
    if webview.label().starts_with(super::LABEL_PREFIX)
        || webview.label().starts_with("conversation-browser-")
    {
        if matches!(payload.url().scheme(), "http" | "https") {
            notify_loading(webview, matches!(payload.event(), PageLoadEvent::Started));
            if matches!(payload.event(), PageLoadEvent::Finished) {
                notify_visit(webview);
            }
        }
        return;
    }
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

fn notify_visit(view: &Webview) {
    let app = view.app_handle().clone();
    let label = view.label().to_string();
    if view
        .eval_with_callback(
            "JSON.stringify({url:location.href,title:document.title,visited:true})",
            move |raw| {
                let value = serde_json::from_str::<serde_json::Value>(&raw)
                    .ok()
                    .and_then(|value| {
                        if let Some(text) = value.as_str() {
                            serde_json::from_str(text).ok()
                        } else {
                            Some(value)
                        }
                    });
                if let Some(value) = value {
                    if app.emit_to("main", &label, value).is_err() {
                        eprintln!("Browser visit notification unavailable");
                    }
                }
            },
        )
        .is_err()
    {
        eprintln!("Browser visit unavailable");
    }
}

pub(super) fn notify_loading(webview: &Webview, loading: bool) {
    if let Err(error) = webview.app_handle().emit_to(
        "main",
        webview.label(),
        serde_json::json!({"loading":loading}),
    ) {
        eprintln!("Browser loading notification failed: {error}");
    }
}
