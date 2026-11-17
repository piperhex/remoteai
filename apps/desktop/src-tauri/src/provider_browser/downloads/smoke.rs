#[test]
#[ignore = "interactive browser download fixture; requires Vite on 1552"]
fn browser_download_fixture() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.browser-downloads".into();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
        window
            .additional_browser_args
            .get_or_insert_default()
            .push_str(" --remote-debugging-port=9372");
    }
    let arguments = context.config().app.windows[0]
        .additional_browser_args
        .clone()
        .unwrap_or_default()
        .replace(
            "--remote-debugging-port=9372",
            "--remote-debugging-port=9371",
        );
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1552".parse().unwrap());
    tauri::Builder::default()
        .any_thread()
        .plugin(tauri_plugin_opener::init())
        .on_page_load(crate::provider_browser::handle_page_load)
        .invoke_handler(tauri::generate_handler![
            super::browser_downloads,
            super::browser_download_action,
            crate::provider_browser::provider_browser_sync,
            crate::provider_browser::provider_browser_action,
            crate::provider_browser::provider_browser_close,
            crate::provider_browser::passwords::provider_browser_password,
            crate::provider_browser::overlays::browser_overlay_prepare,
            crate::provider_browser::overlays::browser_overlay_place,
            crate::provider_browser::overlays::browser_overlay_focus,
            crate::provider_browser::overlays::fixture_size,
        ])
        .setup(move |app| {
            let url = "http://127.0.0.1:1552/e2e/browser-downloads-harness.html?mode=local";
            crate::webview_windows::builder(
                app.handle(),
                "main",
                tauri::WebviewUrl::External(url.parse()?),
            )
            .additional_browser_args(&arguments)
            .title("Browser download verification")
            .inner_size(1200.0, 800.0)
            .focused(false)
            .build()?;
            Ok(())
        })
        .run(context)
        .unwrap();
}
