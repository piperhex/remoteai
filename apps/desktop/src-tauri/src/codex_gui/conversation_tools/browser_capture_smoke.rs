//! Native smoke fixture for the same MCP capture path used by conversations.
use serde_json::Value;

#[tauri::command]
async fn browser_capture_tool(app: tauri::AppHandle, params: Value) -> Value {
    super::protocol::tool_result(super::browser_tools::execute(app, params).await)
}

#[tauri::command]
async fn browser_capture_events(
    app: tauri::AppHandle,
    cursor: Option<crate::codex_gui::web::Cursor>,
) -> Result<crate::codex_gui::web::EventBatch, String> {
    crate::codex_gui::web::poll(&app, cursor, None)
}

#[test]
#[ignore = "requires Vite on 1552, fixture server on 1553 and browser-capture-native.mjs"]
fn opens_browser_capture_tool() {
    use crate::provider_browser::{self, automation};
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.browser-capture-smoke".into();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
        window
            .additional_browser_args
            .get_or_insert_default()
            .push_str(" --remote-debugging-port=9335");
    }
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1552".parse().unwrap());
    tauri::Builder::default()
        .any_thread()
        .manage(automation::State::default())
        .manage(crate::codex_gui::web::WebEventState::default())
        .on_page_load(provider_browser::handle_page_load)
        .invoke_handler(tauri::generate_handler![
            browser_capture_tool,
            browser_capture_events,
            automation::codex_gui_browser,
            automation::codex_gui_browser_place,
            provider_browser::provider_browser_sync,
            provider_browser::provider_browser_action,
            provider_browser::provider_browser_close
        ])
        .setup(|app| {
            let url = "http://127.0.0.1:1552/e2e/website-tabs-harness.html?mode=local&native=1";
            crate::webview_windows::builder(
                app.handle(),
                "main",
                tauri::WebviewUrl::External(url.parse()?),
            )
            .title("Browser capture verification")
            .inner_size(1200.0, 800.0)
            .focused(false)
            .build()?;
            Ok(())
        })
        .run(context)
        .unwrap();
}
