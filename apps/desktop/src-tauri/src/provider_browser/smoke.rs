//! Isolated real-WebView harness for the market-installed Provider list and browser tabs.
use super::*;

#[test]
#[ignore = "interactive browser smoke test; requires the Provider market Vite harness on port 1499"]
fn opens_provider_browser() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.provider-browser-smoke".into();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
        if let Ok(port) = std::env::var("PROVIDER_BROWSER_DEBUG_PORT") {
            let port: u16 = port.parse().expect("valid debugging port");
            window
                .additional_browser_args
                .get_or_insert_default()
                .push_str(&format!(" --remote-debugging-port={port}"));
        }
    }
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1499".parse().unwrap());
    tauri::Builder::default().any_thread()
        .on_page_load(handle_page_load)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![provider_browser_sync, provider_browser_action, provider_browser_close,
            preview::provider_browser_preview])
        .setup(|app| {
            let url = "http://127.0.0.1:1499/e2e/provider-market-harness.html?mode=local&browser=1&language=zh";
            crate::webview_windows::builder(app.handle(), "main", WebviewUrl::External(url.parse()?))
                .title("Provider browser verification").inner_size(1400.0, 900.0).focused(false).build()?;
            Ok(())
        }).run(context).unwrap();
}
