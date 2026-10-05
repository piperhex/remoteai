use super::{protocol::GuiEvent, web};
use serde::Serialize;
use serde_json::json;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum SetupStatus {
    Installing,
    Ready,
    Failed,
}

fn publish(app: &AppHandle, status: SetupStatus) {
    web::publish(
        app,
        "codex-gui-event",
        GuiEvent {
            method: "computerUse/setup".into(),
            params: json!({ "computerUseSetup": status }),
            id: None,
        },
    );
}

pub(super) async fn prepare(app: AppHandle, home: PathBuf) {
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::computer_use::setup_gui(&home, || {
            publish(&worker_app, SetupStatus::Installing);
            #[cfg(windows)]
            super::unattended_setup::start(worker_app.clone());
        })
    })
    .await;
    match result {
        Ok(Ok(())) => publish(&app, SetupStatus::Ready),
        result => {
            eprintln!("Computer Use automatic setup failed: {result:?}");
            publish(&app, SetupStatus::Failed);
        }
    }
}
