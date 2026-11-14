use tauri::{Manager, WebviewUrl};

#[tauri::command]
async fn extension_popup_probe(
    app: tauri::AppHandle,
    id: String,
) -> Result<serde_json::Value, String> {
    let view = app
        .get_webview(&format!("browser-extension-{id}"))
        .ok_or("popup missing")?;
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = std::sync::Mutex::new(Some(send));
    view.eval_with_callback("document.body.innerText", move |value| {
        if let Some(send) = send.lock().unwrap().take() {
            // The test timeout deliberately retires the callback receiver.
            let _ = send.send(value);
        }
    })
    .map_err(|error| error.to_string())?;
    let text = tokio::time::timeout(std::time::Duration::from_secs(5), receive)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let image = super::super::automation::capture_image(view)
        .await
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({"text": text, "image": image}))
}

#[test]
#[ignore = "requires browser extensions Vite harness on port 1582"]
fn opens_extension_browser() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.browser-extensions-smoke".into();
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1582".parse().unwrap());
    for window in &mut context.config_mut().app.windows {
        window.create = false;
        window
            .additional_browser_args
            .get_or_insert_default()
            .push_str(
                " --remote-debugging-port=9365 --disable-features=AutofillAiWalletPrivatePasses",
            );
    }
    tauri::Builder::default()
        .any_thread()
        .manage(super::super::automation::State::default())
        .manage(crate::codex_gui::GuiState::default())
        .manage(crate::codex_gui::web::WebEventState::default())
        .on_page_load(super::super::handle_page_load)
        .invoke_handler(tauri::generate_handler![
            extension_popup_probe,
            crate::codex_gui::codex_gui_request,
            super::super::automation::codex_gui_browser,
            super::super::provider_browser_sync,
            super::super::provider_browser_action,
            super::super::provider_browser_close,
            super::super::preview::provider_browser_preview
        ])
        .setup(|app| {
            let url =
                "http://127.0.0.1:1582/e2e/browser-extensions-harness.html?mode=local&native=1";
            crate::webview_windows::builder(
                app.handle(),
                "main",
                WebviewUrl::External(url.parse()?),
            )
            .title("Browser extensions verification")
            .inner_size(1200.0, 850.0)
            .focused(false)
            .build()?;
            Ok(())
        })
        .run(context)
        .unwrap();
}
