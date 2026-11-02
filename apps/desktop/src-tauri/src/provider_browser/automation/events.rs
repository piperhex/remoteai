use super::{registry, State, LABEL_PREFIX};
use serde_json::Value;
use tauri::{AppHandle, Listener, Manager};

pub(super) fn listen(app: &AppHandle, thread: &str, id: &str) -> tauri::EventId {
    let (handle, thread, id) = (app.clone(), thread.to_owned(), id.to_owned());
    // Provider browser notifications target the main webview, rather than the App event target.
    app.listen_any(format!("{LABEL_PREFIX}{id}"), move |event| {
        let Ok(payload) = serde_json::from_str::<Value>(event.payload()) else {
            return;
        };
        let Some(address) = payload["url"].as_str().map(str::to_owned) else {
            return;
        };
        let (app, thread, id) = (handle.clone(), thread.clone(), id.clone());
        if payload["popup"] == true {
            tauri::async_runtime::spawn(async move {
                if let Err(error) =
                    registry::open(&app, &thread, &address, &uuid::Uuid::new_v4().to_string()).await
                {
                    eprintln!("Browser popup failed: {error}");
                }
            });
        } else {
            // Native navigation callbacks may run on the UI thread; registry locks stay on a worker.
            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = app.state::<State>().navigated(&id, address) {
                    eprintln!("Browser navigation update failed: {error}");
                }
            });
        }
    })
}
