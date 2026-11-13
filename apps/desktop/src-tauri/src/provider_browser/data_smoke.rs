//! Isolated WebView2 UI verification; never uses the installed app profile.
#[test]
#[ignore = "interactive browser data test; requires Vite on port 1572"]
fn opens_browser_data() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.browser-data-smoke".into();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
        window
            .additional_browser_args
            .get_or_insert_default()
            .push_str(" --remote-debugging-port=9355 --ignore-certificate-errors");
    }
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1572".parse().unwrap());
    tauri::Builder::default()
        .any_thread()
        .plugin(tauri_plugin_opener::init())
        .on_page_load(super::handle_page_load)
        .invoke_handler(tauri::generate_handler![
            super::provider_browser_sync,
            super::provider_browser_action,
            super::provider_browser_close,
            super::preview::provider_browser_preview,
            super::passwords::provider_browser_password,
            super::data::provider_browser_clear_data,
            super::inspector::browser_inspector
        ])
        .setup(|app| {
            let url = "http://127.0.0.1:1572/e2e/browser-data-harness.html?mode=local";
            crate::webview_windows::builder(
                app.handle(),
                "main",
                tauri::WebviewUrl::External(url.parse()?),
            )
            .title("Browser data verification")
            .inner_size(1280.0, 860.0)
            .focused(false)
            .build()?;
            Ok(())
        })
        .run(context)
        .unwrap();
}
