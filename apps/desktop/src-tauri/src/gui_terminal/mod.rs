//! Only the main window can open shells; its remote host scopes forwarded handles to authenticated sessions.
pub(crate) mod links;
mod npm;
mod platform;
mod service;
pub(crate) mod ssh;
pub(crate) mod ssh_drop;
#[cfg(test)]
mod tests;
mod types;

pub(crate) use service::TerminalState;
use std::sync::{atomic::Ordering, Arc};
use tauri::{ipc::Channel, AppHandle, Manager, Window};
use types::{OpenTerminal, TerminalError, TerminalEvent, TerminalInfo, TerminalRequest};

fn authorize(window: &Window) -> types::Result<()> {
    if window.label() != "main" {
        return Err(TerminalError::Access);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn codex_gui_terminal_open(
    app: AppHandle,
    window: Window,
    request: OpenTerminal,
    on_event: Channel<TerminalEvent>,
) -> std::result::Result<TerminalInfo, String> {
    authorize(&window).map_err(|error| error.to_string())?;
    let state = app.state::<Arc<TerminalState>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.open(request, Arc::new(move |event| on_event.send(event).is_ok()))
    })
    .await
    .map_err(|_| TerminalError::Start.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn codex_gui_terminal_command(
    app: AppHandle,
    window: Window,
    request: TerminalRequest,
) -> std::result::Result<(), String> {
    authorize(&window).map_err(|error| error.to_string())?;
    let state = app.state::<Arc<TerminalState>>().inner().clone();
    let closing = match &request {
        TerminalRequest::Close { id } => Some(id.clone()),
        _ => None,
    };
    tauri::async_runtime::spawn_blocking(move || state.perform(request))
        .await
        .map_err(|_| TerminalError::Io.to_string())?
        .map_err(|error| error.to_string())?;
    if let Some(scope) = closing {
        app.state::<Arc<links::LinkState>>()
            .perform(links::LinkRequest::Stop { scope })
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Defer the first exit until shells and their consoles have closed off the Windows UI thread.
pub(crate) fn defer_exit(app: &AppHandle, api: &tauri::ExitRequestApi) -> bool {
    static EXIT_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if EXIT_READY.load(Ordering::Acquire) {
        return false;
    }
    api.prevent_exit();
    let state = app.state::<Arc<TerminalState>>().inner().clone();
    if state.exiting.swap(true, Ordering::AcqRel) {
        return true;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !crate::local_proxy::history_persistence::shutdown() {
            state.exiting.store(false, Ordering::Release);
            return;
        }
        crate::update_peers::checkpoint_shutdown();
        state.shutdown();
        EXIT_READY.store(true, Ordering::Release);
        app.exit(0);
    });
    true
}
