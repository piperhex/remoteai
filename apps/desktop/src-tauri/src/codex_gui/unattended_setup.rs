use super::{computer_use_setup::SetupStatus, protocol::GuiEvent, web};
use serde_json::json;
use tauri::AppHandle;

fn publish(app: &AppHandle, status: SetupStatus) {
    web::publish(
        app,
        "codex-gui-event",
        GuiEvent {
            method: "unattended/setup".into(),
            params: json!({ "unattendedSetup": status }),
            id: None,
        },
    );
}

/// Start alongside Computer Use without making chat startup wait for administrator confirmation.
pub(super) fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let worker_app = app.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            crate::desktop_service::setup_gui(&worker_app, || {
                publish(&worker_app, SetupStatus::Installing)
            })
        })
        .await;
        match result {
            Ok(Ok(false)) => {}
            Ok(Ok(true)) => publish(&app, SetupStatus::Ready),
            result => {
                eprintln!("Unattended desktop automatic setup failed: {result:?}");
                publish(&app, SetupStatus::Failed);
            }
        }
    });
}
