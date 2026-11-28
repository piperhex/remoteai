use tauri::{
    webview::{PageLoadEvent, PageLoadPayload},
    Emitter, Manager, Webview,
};

const PAGE_TITLE_SCRIPT: &str =
    "JSON.stringify({pageTitle:{url:location.href,title:document.title}})";

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
    if let Some(state) = app.try_state::<super::mappings::State>() {
        if let Err(error) = state.revoke() {
            eprintln!("Browser mapping cleanup failed: {error}");
        }
    }
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
    let icons =
        include_str!("../../../../../shared/browser/icons/pageIcons.js").replace("export ", "");
    let script = format!(
        "(()=>{{{icons};return JSON.stringify({{url:location.href,title:document.title,\
        visited:true,icons:readPageIcons(document)}});}})()"
    );
    emit_page_metadata(view, &script);
}

pub(super) fn title_changed(view: Webview, _title: String) {
    // Read the URL and DOM title together. Some engines supply the URL as the title of an untitled page.
    emit_page_metadata(&view, PAGE_TITLE_SCRIPT);
}

#[cfg(windows)]
pub(super) fn same_document_navigation(view: &Webview, source: url::Url) {
    let current = view.clone();
    let expected = source.clone();
    // WebView2 changes the source for History API and fragment navigation without changing the DOM title.
    // Send the address and title together so the tab can adopt both in one render.
    let result = read_page_metadata(view, PAGE_TITLE_SCRIPT, move |metadata| {
        if !current.url().is_ok_and(|url| url == expected) {
            return;
        }
        let page = metadata
            .as_ref()
            .and_then(|value| value.get("pageTitle"))
            .filter(|page| page["url"].as_str() == Some(expected.as_str()));
        let payload = match page {
            Some(page) => serde_json::json!({"url": expected.as_str(), "pageTitle": page}),
            None => serde_json::json!({"url": expected.as_str()}),
        };
        emit_metadata(&current, payload);
    });
    if result.is_err() {
        eprintln!("Browser page metadata unavailable");
        emit_metadata(view, serde_json::json!({"url": source.as_str()}));
    }
}

fn emit_page_metadata(view: &Webview, script: &str) {
    let current = view.clone();
    if read_page_metadata(view, script, move |value| {
        if let Some(value) = value {
            emit_metadata(&current, value);
        }
    })
    .is_err()
    {
        eprintln!("Browser page metadata unavailable");
    }
}

fn read_page_metadata(
    view: &Webview,
    script: &str,
    receive: impl Fn(Option<serde_json::Value>) + Send + 'static,
) -> tauri::Result<()> {
    view.eval_with_callback(script, move |raw| {
        let value = serde_json::from_str::<serde_json::Value>(&raw)
            .ok()
            .and_then(|value| match value {
                serde_json::Value::String(text) => serde_json::from_str(&text).ok(),
                value => Some(value),
            });
        receive(value);
    })
}

fn emit_metadata(view: &Webview, value: serde_json::Value) {
    if view
        .app_handle()
        .emit_to("main", view.label(), value)
        .is_err()
    {
        eprintln!("Browser page metadata notification unavailable");
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
