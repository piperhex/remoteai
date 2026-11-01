//! Isolated Tauri/Wry host for the production editor service and app-component fixture.
use tauri::WebviewUrl;

#[path = "../../.codex-tmp/project-editor/native-services/mod.rs"]
mod codex_gui;

#[path = "../../apps/desktop/src-tauri/src/webview_windows.rs"]
mod webview_windows;

#[tauri::command]
async fn project_request(mut input: serde_json::Value) -> Result<serde_json::Value, String> {
    let display_path = input["path"].clone();
    input["cwd"] = std::env::var("PROJECT_EDITOR_PROBE_ROOT")
        .map_err(|error| error.to_string())?
        .into();
    input["path"] = "large.ts".into();
    let mut data = codex_gui::handle(input)
        .await
        .map_err(|error| error.to_string())?;
    if data.is_object() {
        data["path"] = display_path;
    }
    Ok(data)
}

#[tauri::command]
async fn close_probe(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    let mut context = tauri::test::mock_context::<tauri::Wry, _>(tauri::test::noop_assets());
    let manifests = serde_json::from_str(include_str!(
        "../../apps/desktop/src-tauri/gen/schemas/acl-manifests.json"
    ))
    .unwrap();
    let capability: tauri::utils::acl::capability::Capability = serde_json::from_str(include_str!(
        "../../apps/desktop/src-tauri/capabilities/default.json"
    ))
    .unwrap();
    let capabilities = [(capability.identifier.clone(), capability)]
        .into_iter()
        .collect();
    let resolved = tauri::utils::acl::resolved::Resolved::resolve(
        &manifests,
        capabilities,
        tauri::utils::platform::Target::current(),
    )
    .unwrap();
    *context.runtime_authority_mut() = tauri::ipc::RuntimeAuthority::new(manifests, resolved);
    context.config_mut().identifier = "dev.remoteai.project-editor-probe".into();
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1496".parse().unwrap());
    context
        .config_mut()
        .app
        .windows
        .push(tauri::utils::config::WindowConfig {
            label: "main".into(),
            create: false,
            additional_browser_args: Some(
                std::env::var("PROJECT_EDITOR_PROBE_BROWSER_ARGS").unwrap(),
            ),
            ..Default::default()
        });
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![project_request, close_probe])
        .setup(|app| {
            webview_windows::builder(app.handle(), "main", WebviewUrl::App(
                "e2e/project-browser-harness.html?mode=local&largeText=1&editorService=1".into()))
                .title("Project editor verification")
                .inner_size(1440.0, 1000.0)
                .data_directory(std::env::var("PROJECT_EDITOR_PROBE_PROFILE").unwrap().into())
                .initialization_script("window.projectEditorService = input => window.__TAURI_INTERNALS__.invoke('project_request', {input});")
                .build()?;
            Ok(())
        })
        .run(context).unwrap();
}
