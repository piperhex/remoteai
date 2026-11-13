use super::*;
use serde_json::json;

#[test]
fn inspector_requests_reject_unscoped_handles_and_invalid_modes() {
    for request in [
        json!({"id":"main","kind":"provider","command":{"action":"close"}}),
        json!({"id":uuid::Uuid::new_v4(),"kind":"provider","handle":123,"command":{"action":"status"}}),
        json!({"id":uuid::Uuid::new_v4(),"kind":"provider","command":{
            "action":"place","dock":"left","visible":true,"bounds":{"x":0,"y":0,"width":400,"height":400}}}),
    ] {
        assert!(serde_json::from_value::<Request>(request).is_err());
    }
}

#[cfg(windows)]
#[test]
#[ignore = "interactive real inspector test; requires the browser harness on port 1562"]
fn opens_inspector_browser() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.inspector-smoke".into();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
        window
            .additional_browser_args
            .get_or_insert_default()
            .push_str(" --remote-debugging-port=9343");
    }
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1562".parse().unwrap());
    tauri::Builder::default()
        .any_thread()
        .plugin(tauri_plugin_opener::init())
        .on_page_load(crate::provider_browser::handle_page_load)
        .invoke_handler(tauri::generate_handler![
            crate::provider_browser::provider_browser_sync,
            crate::provider_browser::provider_browser_action,
            crate::provider_browser::provider_browser_close,
            browser_inspector,
        ])
        .setup(|app| {
            let url = "http://127.0.0.1:1562/e2e/browser-bookmarks-harness.html?mode=local";
            crate::webview_windows::builder(
                app.handle(),
                "main",
                tauri::WebviewUrl::External(url.parse()?),
            )
            .title("Browser inspector verification")
            .inner_size(1440.0, 900.0)
            .focused(false)
            .build()?;
            Ok(())
        })
        .run(context)
        .unwrap();
}
