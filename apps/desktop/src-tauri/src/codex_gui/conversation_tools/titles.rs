//! Name tool-created conversations independently of open local or remote chat views.
use tauri::{AppHandle, Manager};

use crate::codex_gui::{connected, title_generation::TitleRequest, GuiState, Result};

pub(super) fn generate(app: AppHandle, thread_id: String, prompt: String) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = generate_title(app, thread_id, prompt).await {
            eprintln!("Codex GUI tool conversation naming failed: {error}");
        }
    });
}

async fn generate_title(app: AppHandle, thread_id: String, prompt: String) -> Result<()> {
    // Match ordinary GUI sends when the public settings endpoint is offline or unavailable.
    let settings = crate::cloud::fetch_cloud_title_settings(app.clone())
        .await
        .unwrap_or_default();
    let state = app.state::<GuiState>();
    let client = connected(&state).await?;
    client
        .generate_title(TitleRequest {
            thread_id,
            prompt,
            settings,
        })
        .await?;
    Ok(())
}
