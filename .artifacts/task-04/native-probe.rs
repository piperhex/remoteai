use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{ipc::Response, Manager, WebviewUrl};
static SHARED_READS: AtomicUsize = AtomicUsize::new(0);
static USAGE_READS: [AtomicUsize; 4] = [const { AtomicUsize::new(0) }; 4];
#[path = "../../apps/desktop/src-tauri/src/webview_windows.rs"]
mod webview_windows;

#[tauri::command]
async fn list_token_usage_entries() -> Response {
    USAGE_READS[0].fetch_add(1, Ordering::SeqCst);
    Response::new(r#"[{"id":"native-fixture","ts":1793516400,"provider":"Native fixture","model":"test","totalTokens":50000}]"#.to_owned())
}
#[tauri::command]
async fn list_daily_token_usage() -> Response {
    USAGE_READS[1].fetch_add(1, Ordering::SeqCst);
    Response::new("[]".to_owned())
}
#[tauri::command]
async fn list_token_usage_breakdown() -> Response {
    USAGE_READS[2].fetch_add(1, Ordering::SeqCst);
    Response::new("[]".to_owned())
}
#[tauri::command]
async fn list_account_quota_history() -> Response {
    USAGE_READS[3].fetch_add(1, Ordering::SeqCst);
    Response::new("[]".to_owned())
}
#[tauri::command]
async fn get_official_usage_summary() -> Response {
    Response::new(r#"{"accounts":[],"status":"signedOut","updatedAt":0}"#.to_owned())
}

#[tauri::command]
async fn probe_shared_read() -> Response {
    let value = SHARED_READS.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(100))
    })
    .await
    .unwrap();
    Response::new(value.to_string())
}
#[tauri::command]
async fn probe_counts() -> Response {
    Response::new(
        serde_json::to_string(
            &USAGE_READS
                .each_ref()
                .map(|count| count.load(Ordering::SeqCst)),
        )
        .unwrap(),
    )
}
#[tauri::command]
async fn probe_control(app: tauri::AppHandle, label: String, action: String) -> Result<(), String> {
    if action == "reopen" && label == "token-usage" {
        return webview_windows::builder(
            &app,
            &label,
            WebviewUrl::App("e2e/token-native-harness.html".into()),
        )
        .title("Token lifecycle probe: token-usage")
        .inner_size(1180.0, 780.0)
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string());
    }
    let window = app
        .get_webview_window(&label)
        .ok_or("missing fixture window")?;
    match action.as_str() {
        "minimize" => window.minimize(),
        "restore" => window.unminimize(),
        "hide" => window.hide(),
        "show" => window.show(),
        "focus" => window.set_focus(),
        "destroy" => window.destroy(),
        "close" => {
            app.exit(0);
            Ok(())
        }
        _ => return Err("unsupported fixture action".into()),
    }
    .map_err(|error| error.to_string())
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
    context.config_mut().identifier = "dev.remoteai.token-lifecycle-probe".into();
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1544".parse().unwrap());
    let arguments = std::env::var("TOKEN_PROBE_BROWSER_ARGS").unwrap();
    context
        .config_mut()
        .app
        .windows
        .push(tauri::utils::config::WindowConfig {
            label: "main".into(),
            create: false,
            additional_browser_args: Some(arguments),
            ..Default::default()
        });
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_token_usage_entries,
            list_daily_token_usage,
            list_token_usage_breakdown,
            list_account_quota_history,
            get_official_usage_summary,
            probe_shared_read,
            probe_control,
            probe_counts
        ])
        .setup(move |app| {
            for (index, label) in ["main", "token-usage"].iter().enumerate() {
                let builder = webview_windows::builder(
                    app.handle(),
                    *label,
                    WebviewUrl::App("e2e/token-native-harness.html".into()),
                );
                let builder = if *label == "main" {
                    builder.background_throttling(
                        tauri::utils::config::BackgroundThrottlingPolicy::Disabled,
                    )
                } else {
                    builder
                };
                builder
                    .title(format!("Token lifecycle probe: {label}"))
                    .inner_size(1180.0, 780.0)
                    .position(20.0 + index as f64 * 80.0, 20.0 + index as f64 * 70.0)
                    .build()?;
            }
            Ok(())
        })
        .run(context)
        .unwrap();
}
