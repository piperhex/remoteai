use std::time::Duration;

use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::AppHandle;

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
    let state = app.state::<TrayState>();
    send(&state, Event::Update(fixture()))?;
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

fn fixture() -> Messages {
    let avatar = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(include_bytes!("../../../icons/16x16.png"))
    );
    let senders = HashMap::from([
        (
            "mira".into(),
            Sender {
                name: "米拉".into(),
                avatar: Some(avatar),
            },
        ),
        (
            "yuki".into(),
            Sender {
                name: "团子".into(),
                avatar: None,
            },
        ),
    ]);
    let messages = [
        ("mira", "测试消息收到了。", "2026-11-28T05:08:00Z"),
        (
            "mira",
            "同一位联系人发来的另一条消息。",
            "2026-11-28T05:07:00Z",
        ),
        ("yuki", "等你有空一起看一下。", "2026-11-28T05:06:00Z"),
    ]
    .into_iter()
    .map(|(sender, text, sent_at)| Message {
        key: sent_at.into(),
        sender_id: sender.into(),
        sent_at: sent_at.into(),
        text: text.into(),
        image_count: 0,
    })
    .collect();
    Messages { messages, senders }
}
