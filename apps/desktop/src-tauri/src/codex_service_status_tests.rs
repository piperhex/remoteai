use super::*;
use serde_json::json;

fn response(api: &str, cli: &str) -> CodexServiceStatus {
    let bytes = serde_json::to_vec(&json!({ "components": [
        { "id": API_ID, "name": "Codex API", "status": api },
        { "id": CLI_ID, "name": "CLI", "status": cli },
        { "name": "ChatGPT", "status": "major_outage" },
        { "name": "Codex Web", "status": "major_outage" }
    ] }))
    .unwrap();
    parse_status(&bytes).unwrap()
}

#[test]
fn only_codex_api_and_cli_determine_health() {
    let value = response("operational", "operational");
    assert_eq!(value.api, ServiceHealth::Operational);
    assert_eq!(value.cli, ServiceHealth::Operational);
}

#[test]
fn either_component_can_be_disrupted() {
    for state in [
        "degraded_performance",
        "partial_outage",
        "major_outage",
        "under_maintenance",
    ] {
        assert_eq!(response(state, "operational").api, ServiceHealth::Disrupted);
        assert_eq!(response("operational", state).cli, ServiceHealth::Disrupted);
    }
}

#[test]
fn absent_or_unrecognized_status_is_never_healthy() {
    let value = parse_status(br#"{"components":[]}"#).unwrap();
    assert_eq!(value.api, ServiceHealth::Unknown);
    assert_eq!(value.cli, ServiceHealth::Unknown);
    assert_eq!(
        response("new_state", "operational").api,
        ServiceHealth::Unknown
    );
    assert!(parse_status(br#"{"components":null}"#).is_err());
}

#[test]
fn stable_ids_survive_renames_and_names_allow_replacement_ids() {
    let bytes = serde_json::to_vec(&json!({ "components": [
        { "id": API_ID, "name": "Renamed API", "status": "partial_outage" },
        { "id": "replacement-cli-id", "name": "CLI", "status": "operational" }
    ] }))
    .unwrap();
    let value = parse_status(&bytes).unwrap();
    assert_eq!(value.api, ServiceHealth::Disrupted);
    assert_eq!(value.cli, ServiceHealth::Operational);
}

#[cfg(windows)]
#[test]
#[ignore = "real WebView smoke test; requires the status Vite harness on port 1563"]
fn opens_native_status_browser() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "dev.codex.switch.codex-status-smoke".into();
    for window in &mut context.config_mut().app.windows {
        window.create = false;
        window
            .additional_browser_args
            .get_or_insert_default()
            .push_str(
                " --remote-debugging-port=1564 --disable-features=AutofillAiWalletPrivatePasses",
            );
    }
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1563".parse().unwrap());
    tauri::Builder::default()
        .any_thread()
        .manage(crate::provider_browser::automation::State::default())
        .manage(crate::codex_gui::web::WebEventState::default())
        .on_page_load(crate::provider_browser::handle_page_load)
        .invoke_handler(tauri::generate_handler![
            get_codex_service_status,
            crate::provider_browser::automation::codex_gui_browser,
            crate::provider_browser::provider_browser_sync,
            crate::provider_browser::preview::provider_browser_preview,
            crate::provider_browser::provider_browser_action,
            crate::provider_browser::provider_browser_close
        ])
        .setup(|app| {
            let url = "http://127.0.0.1:1563/e2e/codex-status-harness.html?mode=local";
            crate::webview_windows::builder(
                app.handle(),
                "main",
                tauri::WebviewUrl::External(url.parse()?),
            )
            .title("Codex status verification")
            .inner_size(1440.0, 900.0)
            .focused(false)
            .build()?;
            Ok(())
        })
        .run(context)
        .unwrap();
}
