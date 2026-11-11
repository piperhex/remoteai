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
        crate::computer_use::setup_gui(&worker_app, &home, |kind| {
            publish(&worker_app, SetupStatus::Installing);
            // CUA upgrades must not trigger installation of a separate desktop service.
            if matches!(kind, crate::computer_use::SetupKind::FirstInstall) {
                #[cfg(windows)]
                super::unattended_setup::start(worker_app.clone());
            }
        })?;
        #[cfg(windows)]
        if let Err(error) = crate::computer_use::administrator::prepare_gui(&home) {
            // Cancellation leaves normal CUA available; do not turn a declined UAC prompt into a failed installation.
            eprintln!("Computer Use administrator authorization unavailable: {error}");
        }
        Ok::<_, crate::computer_use::ComputerError>(())
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
