use std::{sync::atomic::Ordering, time::Duration};

use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::{access, store, types::*, ScheduledTasksState};
use crate::codex_gui::{
    self,
    error::{GuiError, Result as GuiResult},
    protocol::{AccessMode, GuiRequest},
    GuiState,
};

const POLL_INTERVAL: Duration = Duration::from_secs(10);
const MAX_CONCURRENT_TASKS: usize = 3;

pub(super) fn start(app: AppHandle) {
    if app
        .state::<ScheduledTasksState>()
        .started
        .swap(true, Ordering::AcqRel)
    {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if access(app.clone(), |tasks| {
            store::recover(tasks);
            Ok(())
        })
        .await
        .is_err()
        {
            eprintln!("Codex GUI could not restore scheduled tasks");
        }
        let mut interval = tokio::time::interval(POLL_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if tick(app.clone()).await.is_err() {
                eprintln!("Codex GUI could not refresh scheduled tasks");
            }
        }
    });
}

async fn tick(app: AppHandle) -> Result<()> {
    let running = access(app.clone(), |tasks| {
        Ok(tasks
            .iter()
            .filter(|task| task.run_status == RunStatus::Running)
            .cloned()
            .collect::<Vec<_>>())
    })
    .await?;
    for task in &running {
        refresh_run(app.clone(), task).await?;
    }
    let available = MAX_CONCURRENT_TASKS.saturating_sub(running.len());
    let claimed = access(app.clone(), move |tasks| {
        store::claim(tasks, chrono::Utc::now().timestamp_millis(), available)
    })
    .await?;
    for task in claimed {
        if execute(app.clone(), &task).await.is_err() {
            access(app.clone(), move |tasks| {
                store::finish(store::find(tasks, &task.id)?, false);
                Ok(())
            })
            .await?;
        }
    }
    Ok(())
}

async fn request(app: &AppHandle, request: GuiRequest) -> GuiResult<Value> {
    codex_gui::execute_request(&app.state::<GuiState>(), request)
        .await
        .map(|response| response.data)
}

async fn execute(app: AppHandle, task: &ScheduledTask) -> Result<()> {
    codex_gui::connect(app.clone(), &app.state::<GuiState>(), true, false)
        .await
        .map_err(|_| TaskError::Execution)?;
    // A fresh conversation never changes the currently selected chat or shares another task's turn.
    let thread_id = start_thread(&app, task).await?;
    record_thread(app.clone(), task.id.clone(), thread_id.clone()).await?;
    let turn_id = send_task(&app, task, thread_id).await?;
    let task_id = task.id.clone();
    access(app, move |tasks| {
        store::find(tasks, &task_id)?.last_turn_id = turn_id;
        Ok(())
    })
    .await
}

async fn start_thread(app: &AppHandle, task: &ScheduledTask) -> Result<String> {
    let response = request(
        app,
        GuiRequest::Start {
            cwd: Some(task.input.cwd.clone()),
            model: None,
            access: AccessMode::WorkspaceWrite,
        },
    )
    .await
    .map_err(|_| TaskError::Execution)?;
    let thread_id = response["thread"]["id"]
        .as_str()
        .ok_or(TaskError::Execution)?
        .to_owned();
    if request(
        app,
        GuiRequest::Rename {
            thread_id: thread_id.clone(),
            name: task.input.title.clone(),
        },
    )
    .await
    .is_err()
    {
        // A display name failure must not drop an otherwise runnable task.
        eprintln!("Codex GUI could not name a scheduled task conversation");
    }
    Ok(thread_id)
}

async fn record_thread(app: AppHandle, task_id: String, thread_id: String) -> Result<()> {
    access(app, move |tasks| {
        let task = store::find(tasks, &task_id)?;
        task.last_thread_id = Some(thread_id);
        // Persist before sending: an accepted turn with a lost reply still owns its execution slot.
        task.run_status = RunStatus::Running;
        Ok(())
    })
    .await
}

async fn send_task(
    app: &AppHandle,
    task: &ScheduledTask,
    thread_id: String,
) -> Result<Option<String>> {
    let response = request(
        app,
        GuiRequest::Send {
            transfer_mode: Default::default(),
            thread_id,
            text: task.input.prompt.clone(),
            images: Vec::new(),
            skills: Vec::new(),
            attachments: Vec::new(),
            access: Some(AccessMode::WorkspaceWrite),
            model: None,
            effort: None,
            cwd: None,
        },
    )
    .await;
    submitted_turn(response)
}

pub(super) fn submitted_turn(response: GuiResult<Value>) -> Result<Option<String>> {
    match response {
        Ok(value) => Ok(value["turn"]["id"].as_str().map(str::to_owned)),
        // A timeout is not proof of rejection; inspect this new thread before allowing another run.
        Err(GuiError::Timeout) => Ok(None),
        Err(_) => Err(TaskError::Execution),
    }
}

async fn refresh_run(app: AppHandle, task: &ScheduledTask) -> Result<()> {
    let thread_id = task.last_thread_id.clone().ok_or(TaskError::Execution)?;
    let observation = match request(
        &app,
        GuiRequest::Read {
            thread_id,
            window: None,
        },
    )
    .await
    {
        Ok(value) => observe_turn(&value, task.last_turn_id.as_deref()),
        // A transient read failure cannot prove that the turn stopped; keep its execution slot.
        Err(_) if codex_gui::connected(&app.state::<GuiState>()).await.is_ok() => None,
        Err(_) => Some(RunObservation {
            turn_id: None,
            completed: Some(false),
        }),
    };
    let Some(observation) = observation else {
        return Ok(());
    };
    let task_id = task.id.clone();
    access(app, move |tasks| {
        let task = store::find(tasks, &task_id)?;
        if task.last_turn_id.is_none() {
            task.last_turn_id = observation.turn_id;
        }
        if let Some(success) = observation.completed {
            store::finish(task, success);
        }
        Ok(())
    })
    .await
}

pub(super) struct RunObservation {
    pub(super) turn_id: Option<String>,
    pub(super) completed: Option<bool>,
}

pub(super) fn observe_turn(response: &Value, turn_id: Option<&str>) -> Option<RunObservation> {
    let turns = response["thread"]["turns"].as_array()?;
    // Only a fresh, per-run thread may be inspected without an acknowledged turn ID.
    let turn = match turn_id {
        Some(id) => turns.iter().find(|turn| turn["id"].as_str() == Some(id))?,
        None => turns.last()?,
    };
    let completed = match turn["status"].as_str()? {
        "completed" => Some(true),
        "failed" | "interrupted" => Some(false),
        _ => None,
    };
    Some(RunObservation {
        turn_id: Some(turn["id"].as_str()?.to_owned()),
        completed,
    })
}
