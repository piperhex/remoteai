use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, State};

use super::{
    connected,
    error::{GuiError, Result},
    protocol::{GuiEvent, GuiRequest},
    GuiState,
};
use crate::conversation_hub::{
    deletion_plan::{self, DeletionError, DeletionPlan},
    MutationReport, ThreadContext,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeletionReport {
    #[serde(flatten)]
    report: MutationReport,
    deleted_thread_ids: Vec<String>,
}

/// Deletes the selected GUI conversation and its descendants within the built-in home.
#[tauri::command]
pub(crate) async fn codex_gui_delete_thread(
    app: AppHandle,
    state: State<'_, GuiState>,
    thread_id: String,
) -> std::result::Result<DeletionReport, String> {
    delete_thread(app, &state, thread_id)
        .await
        .map_err(|error| error.to_string())
}

async fn delete_thread(
    app: AppHandle,
    state: &GuiState,
    thread_id: String,
) -> Result<DeletionReport> {
    GuiRequest::Read {
        window: None,
        thread_id: thread_id.clone(),
    }
    .into_rpc()?;
    let client = connected(state).await?;
    let (context, plan) = prepare_deletion(app.clone(), thread_id).await?;
    let ids = plan.thread_ids.clone();
    let _subscriptions = client.prepare_deletion(&ids).await?;
    let report =
        tauri::async_runtime::spawn_blocking(move || deletion_plan::discard(context, plan))
            .await
            .map_err(|_| GuiError::Delete)?
            .map_err(deletion_error)?;
    for id in &ids {
        super::web::publish(
            &app,
            "codex-gui-event",
            GuiEvent {
                method: "thread/deleted".into(),
                params: json!({ "threadId": id }),
                id: None,
            },
        );
    }
    Ok(DeletionReport {
        report,
        deleted_thread_ids: ids,
    })
}

async fn prepare_deletion(
    app: AppHandle,
    thread_id: String,
) -> Result<(ThreadContext<tauri::Wry>, DeletionPlan)> {
    let worker_app = app.clone();
    let (context, plan) = tauri::async_runtime::spawn_blocking(move || {
        let context = ThreadContext::new(
            worker_app,
            Some(crate::codex_home::GUI_CODEX_HOME_ID.into()),
        )?;
        let plan = deletion_plan::prepare(&context, thread_id)?;
        Ok::<_, DeletionError>((context, plan))
    })
    .await
    .map_err(|_| GuiError::Delete)?
    .map_err(deletion_error)?;
    if super::queue_store::has_pending(app, &plan.thread_ids)
        .await
        .map_err(|_| GuiError::Delete)?
    {
        return Err(GuiError::Busy);
    }
    Ok((context, plan))
}

fn deletion_error(error: DeletionError) -> GuiError {
    eprintln!("Unable to move GUI conversation tree to trash: {error}");
    match error {
        DeletionError::MissingHistory => GuiError::DeleteMissingHistory,
        DeletionError::Changed => GuiError::DeleteChanged,
        DeletionError::Storage(_) => GuiError::Delete,
    }
}
