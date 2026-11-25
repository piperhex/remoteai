use super::*;
use serde_json::json;

#[cfg(windows)]
#[tauri::command]
pub(crate) async fn open_inspector_fixture(
    webview: Webview,
    request: Request,
) -> std::result::Result<(), String> {
    let view = target(&webview, &request).map_err(|error| error.to_string())?;
    windows::open_fixture(&view)
        .await
        .map_err(|error| error.to_string())
}

#[test]
fn inspector_requests_reject_unscoped_handles_and_invalid_modes() {
    for request in [
        json!({"id":"main","kind":"provider","command":{"action":"close"}}),
        json!({"id":uuid::Uuid::new_v4(),"kind":"provider","handle":123,"command":{"action":"status"}}),
        json!({"id":uuid::Uuid::new_v4(),"kind":"provider","command":{
            "action":"setMobile","enabled":true,"name":"arbitrary User-Agent"}}),
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
            .push_str(" --remote-debugging-port=9344");
    }
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1562".parse().unwrap());
    let main_arguments = context.config().app.windows[0]
        .additional_browser_args
        .as_deref()
        .unwrap()
        .replace(
            "--remote-debugging-port=9344",
            "--remote-debugging-port=9343",
        );
    tauri::Builder::default()
        .any_thread()
        .plugin(tauri_plugin_opener::init())
        .on_page_load(crate::provider_browser::handle_page_load)
        .invoke_handler(tauri::generate_handler![
            crate::provider_browser::provider_browser_sync,
            crate::provider_browser::provider_browser_action,
            crate::provider_browser::provider_browser_close,
            browser_inspector,
            open_inspector_fixture,
        ])
        .setup(move |app| {
            let url = "http://127.0.0.1:1562/e2e/browser-bookmarks-harness.html?mode=local";
            crate::webview_windows::builder(
                app.handle(),
                "main",
                tauri::WebviewUrl::External(url.parse()?),
            )
            .additional_browser_args(&main_arguments)
            .title("Browser inspector verification")
            .inner_size(1440.0, 900.0)
            .focused(false)
            .build()?;
            Ok(())
        })
        .run(context)
        .unwrap();
}
