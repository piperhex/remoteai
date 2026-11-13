use super::{protocol, Action, Request};
use serde_json::json;

#[test]
fn browser_operations_reject_unscoped_tabs_and_arbitrary_execution() {
    for value in [
        json!({"threadId":"thread","command":{"action":"evaluate","script":"alert(1)"}}),
        json!({"threadId":"thread","command":{"action":"click","reference":"a"},"tabId":"main"}),
        json!({"threadId":"thread","command":{"action":"snapshot"}}),
        json!({"threadId":"../thread","command":{"action":"list"}}),
    ] {
        assert!(serde_json::from_value::<Request>(value)
            .map_or(true, |request| request.validate().is_err()));
    }
    let request: Request =
        serde_json::from_value(json!({"threadId":"thread","command":{"action":"list"}})).unwrap();
    assert!(request.validate().is_ok());
}

#[test]
fn bounded_input_and_keys_are_validated_before_native_dispatch() {
    let mut request = Request {
        thread_id: "thread".into(),
        tab_id: Some(uuid::Uuid::new_v4().to_string()),
        action: Action::Type {
            reference: "ref".into(),
            text: "a".repeat(16_001),
        },
    };
    assert!(request.validate().is_err());
    request.action = Action::Key { key: "F12".into() };
    assert!(request.validate().is_err());
    request.action = Action::Scroll { x: i32::MIN, y: 0 };
    assert!(request.validate().is_err());
    assert!(!protocol::identifier(""));
    assert!(protocol::identifier("thread-1"));
}

#[cfg(windows)]
#[test]
#[ignore = "interactive WebView test; requires Vite on 1552 and the preview fixture server on 1553"]
fn opens_conversation_browser() {
    use tauri::WebviewUrl;
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.conversation-browser-smoke".into();
    let debug_port = std::env::var("BROWSER_TEST_DEBUG_PORT").unwrap_or_else(|_| "9333".into());
    let debug_port: u16 = debug_port.parse().expect("valid test debugging port");
    for window in &mut context.config_mut().app.windows {
        window.create = false;
        window
            .additional_browser_args
            .get_or_insert_default()
            .push_str(&format!(" --remote-debugging-port={debug_port}"));
    }
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1552".parse().unwrap());
    tauri::Builder::default().any_thread()
        .manage(super::State::default())
        .manage(crate::codex_gui::web::WebEventState::default())
        .plugin(tauri_plugin_opener::init())
        .on_page_load(super::super::handle_page_load)
        .invoke_handler(tauri::generate_handler![
            super::codex_gui_browser, super::codex_gui_browser_place,
            super::super::provider_browser_sync, super::super::provider_browser_action,
            super::super::provider_browser_close,
            super::super::preview::provider_browser_preview,
            super::super::inspector::browser_inspector,
        ])
        .setup(|app| {
            let url = "http://127.0.0.1:1552/e2e/website-tabs-harness.html?mode=local&native=1&origin=http://127.0.0.1:1553";
            crate::webview_windows::builder(app.handle(), "main", WebviewUrl::External(url.parse()?))
                .title("Conversation browser verification").inner_size(1440.0, 900.0).focused(false).build()?;
            Ok(())
        }).run(context).unwrap();
}
