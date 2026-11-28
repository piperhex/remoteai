use std::time::Duration;

use super::*;
use tauri::AppHandle;

#[tauri::command]
fn cloud_lounge_ticket() -> serde_json::Value {
    serde_json::json!({ "ticket": "tray-fixture" })
}

#[test]
#[ignore = "requires an interactive Windows desktop and Vite on port 1489"]
fn hover_and_ignore_real_tray_messages() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.lounge-tray-smoke".into();
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1489".parse().unwrap());
    for window in &mut context.config_mut().app.windows {
        window.create = false;
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    tauri::Builder::default()
        .any_thread()
        .invoke_handler(tauri::generate_handler![
            cloud_lounge_ticket,
            lounge_tray_update,
            lounge_tray_snapshot,
            lounge_tray_present,
            lounge_tray_activate,
        ])
        .setup(move |app| {
            super::super::setup(app)?;
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(Duration::from_secs(120), exercise(&app))
                    .await
                    .map_err(|_| "hover the fixture tray icon and click Dismiss all".into())
                    .and_then(|result| result);
                sender.send(result).unwrap();
                app.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap()
        .run_return(|_, _| {});
    receiver.recv().unwrap().unwrap();
}

async fn exercise(app: &AppHandle) -> Result<(), String> {
    // Exercise the normal controller, including the receipt path and WebView IPC, while hidden.
    crate::webview_windows::builder(
        app,
        "main",
        tauri::WebviewUrl::App("e2e/lounge-tray-harness.html".into()),
    )
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    let state = app.state::<TrayState>();
    wait_for_private_messages(&state).await?;
    eprintln!("both eligible tray messages arrived; hover the tray icon and click Dismiss all");
    let mut opened = false;
    loop {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let visible = app
            .get_webview_window(LABEL)
            .map(|window| window.is_visible())
            .transpose()
            .map_err(|error| error.to_string())?
            .unwrap_or(false);
        opened |= visible;
        let snapshot = state.snapshot.borrow();
        if opened && !visible && snapshot.messages.messages.is_empty() {
            return Ok(());
        }
    }
}

async fn wait_for_private_messages(state: &TrayState) -> Result<(), String> {
    tokio::time::timeout(Duration::from_secs(45), async {
        loop {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let snapshot = state.snapshot.borrow();
            let entries = &snapshot.messages;
            if entries.messages.len() < 2 {
                continue;
            }
            let valid_messages = entries.messages.len() == 2
                && entries
                    .messages
                    .iter()
                    .all(|message| message.sender_id == "sender");
            let valid_avatar = entries
                .senders
                .get("sender")
                .is_some_and(|sender| sender.avatar.is_some());
            return (valid_messages && valid_avatar)
                .then_some(())
                .ok_or_else(|| "the tray received unexpected messages or avatar data".into());
        }
    })
    .await
    .map_err(|_| "private messages never reached Windows tray IPC".to_owned())?
}
