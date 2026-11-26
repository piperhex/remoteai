use super::{registry, State, LABEL_PREFIX};
use serde_json::Value;
use tauri::{AppHandle, Listener, Manager};

pub(super) fn listen(app: &AppHandle, thread: &str, id: &str) -> tauri::EventId {
    let (send, mut receive) = tokio::sync::mpsc::unbounded_channel::<Value>();
    let (handle, thread, tab_id) = (app.clone(), thread.to_owned(), id.to_owned());
    // Navigation and title changes must reach the registry in dispatch order, off the UI thread.
    tauri::async_runtime::spawn(async move {
        while let Some(payload) = receive.recv().await {
            handle_event(&handle, &thread, &tab_id, payload);
        }
    });
    app.listen_any(format!("{LABEL_PREFIX}{id}"), move |event| {
        if let Ok(payload) = serde_json::from_str(event.payload()) {
            if send.send(payload).is_err() {
                eprintln!("Browser event receiver unavailable");
            }
        }
    })
}

fn handle_event(app: &AppHandle, thread: &str, id: &str, payload: Value) {
    if let Some(page) = payload.get("pageTitle") {
        publish_title(app, thread, id, page);
        return;
    }
    if let Some(loading) = payload["loading"].as_bool() {
        loading_changed(app, thread, id, loading);
    }
    let Some(address) = payload["url"].as_str() else {
        return;
    };
    if payload["popup"] == true {
        let (app, thread, id, address) = (
            app.clone(),
            thread.to_owned(),
            id.to_owned(),
            address.to_owned(),
        );
        tauri::async_runtime::spawn(async move {
            let destination = app
                .state::<State>()
                .get(&thread, &id)
                .ok()
                .map(|tab| tab.destination);
            if let Err(error) = registry::open_at(
                &app,
                &thread,
                registry::OpenOptions {
                    address: &address,
                    request: &uuid::Uuid::new_v4().to_string(),
                    destination,
                },
            )
            .await
            {
                eprintln!("Browser popup failed: {error}");
            }
        });
        return;
    }
    let state = app.state::<State>();
    if payload["visited"] != true {
        if let Err(error) = state.navigated(id, address.to_owned()) {
            eprintln!("Browser navigation update failed: {error}");
        }
    }
    publish_title(app, thread, id, &payload);
    if let Ok(icons) = serde_json::from_value::<Vec<String>>(payload["icons"].clone()) {
        if let Err(error) = state.icons(id, address, icons) {
            eprintln!("Browser icon update failed: {error}");
        }
    }
}

fn publish_title(app: &AppHandle, thread: &str, id: &str, page: &Value) {
    let (Some(url), Some(title)) = (page["url"].as_str(), page["title"].as_str()) else {
        return;
    };
    match app.state::<State>().title(id, url, title) {
        Ok(true) => crate::codex_gui::web::publish(
            app,
            "codex-gui-event",
            serde_json::json!({"method":"browser/title",
                "params":{"threadId":thread,"tabId":id,"url":url,"title":title}}),
        ),
        Ok(false) => (),
        Err(error) => eprintln!("Browser title update failed: {error}"),
    }
}

fn loading_changed(app: &AppHandle, thread: &str, id: &str, loading: bool) {
    if let Err(error) = app.state::<State>().loading(id, loading) {
        eprintln!("Browser loading update failed: {error}");
    }
    crate::codex_gui::web::publish(
        app,
        "codex-gui-event",
        serde_json::json!({
            "method":"browser/loading", "params":{"threadId":thread,"tabId":id,"loading":loading}
        }),
    );
}
