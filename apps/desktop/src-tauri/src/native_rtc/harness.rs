//! Isolated native RTC verification window. Does not run application startup or register global helpers.
#[cfg(windows)]
#[test]
#[ignore = "Manual native RTC viewer verification; requires the loopback Vite fixture"]
fn opens_native_rtc() {
    use crate::codex_gui::file_stream::{bulk_encrypted, bulk_send, rtc_fixture};
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = std::env::var("BROWSER_TEST_IDENTIFIER").unwrap();
    let port: u16 = std::env::var("BROWSER_TEST_DEBUG_PORT")
        .unwrap()
        .parse()
        .unwrap();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
    }
    context.config_mut().build.dev_url = Some("http://127.0.0.1:18787".parse().unwrap());
    tauri::Builder::default()
        .any_thread()
        .manage(super::State::default())
        .manage(crate::codex_gui::GuiState::default())
        .manage(super::media_fixture::Fixtures::default())
        .invoke_handler(tauri::generate_handler![
            bulk_encrypted::codex_gui_file_bulk_sender_open,
            bulk_send::codex_gui_file_bulk_sender_send,
            rtc_fixture::native_rtc_file_fixture_open,
            rtc_fixture::native_rtc_file_fixture_close,
            super::native_rtc_open,
            super::native_rtc_operation,
            super::native_rtc_poll,
            super::native_rtc_receive,
            super::native_rtc_send,
            super::native_rtc_close,
            super::media_fixture::native_rtc_fixture_open,
            super::media_fixture::native_rtc_fixture_signal,
            super::media_fixture::native_rtc_fixture_close,
        ])
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(
                    "http://127.0.0.1:18787/e2e/native-rtc-harness.html".parse()?,
                ),
            )
            .additional_browser_args(&format!(
                "--remote-debugging-port={port} --disable-background-timer-throttling \
                    --disable-renderer-backgrounding --disable-backgrounding-occluded-windows"
            ))
            .title("Native RTC verification")
            .inner_size(1100.0, 760.0)
            .focused(false)
            .build()?;
            Ok(())
        })
        .run(context)
        .unwrap();
}
