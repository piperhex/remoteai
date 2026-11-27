//! Isolated WebView2 UI verification; never uses the installed app profile.
#[test]
#[ignore = "interactive browser data test; requires Vite on port 1572"]
fn opens_browser_data() {
    run("dev.codex.switch.browser-data-smoke", true);
}

#[test]
#[ignore = "interactive certificate test; requires Vite on port 1572"]
fn opens_browser_certificates() {
    run("dev.codex.switch.browser-certificate-smoke", false);
}

fn run(identifier: &str, ignore_certificate_errors: bool) {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = identifier.into();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
        let args = window.additional_browser_args.get_or_insert_default();
        args.push_str(" --remote-debugging-port=9355");
        if ignore_certificate_errors {
            args.push_str(" --ignore-certificate-errors");
        } else {
            // A preloaded HSTS hostname exercises a fatal TLS error against the loopback fixture.
            args.push_str(" --host-resolver-rules=\"MAP remoteai-certificate.test.dev 127.0.0.1\"");
            args.push_str(" --proxy-bypass-list=remoteai-certificate.test.dev");
        }
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
            super::overlays::browser_overlay_prepare,
            super::overlays::browser_overlay_place,
            super::overlays::browser_overlay_focus,
            super::passwords::provider_browser_password,
            super::vault_key::browser_vault_key,
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
