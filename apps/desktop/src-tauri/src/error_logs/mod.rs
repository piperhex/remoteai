//! Persist bounded, sanitized proxy errors and user notifications off the UI thread.

mod database;
mod models;
#[cfg(test)]
mod pagination_tests;
mod sanitize;
mod schema;
#[cfg(test)]
mod tests;
mod worker;

use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};

pub(crate) use models::{ErrorLogPage, ErrorLogPagination, ErrorLogSource};
use models::{ListQuery, LogError};
use worker::LogService;

pub(crate) const DIAGNOSTIC_MESSAGE_MAX_CHARS: usize = sanitize::MAX_MESSAGE_CHARS;

const DATABASE_FILENAME: &str = "error-logs.sqlite";
static SERVICE: OnceLock<LogService> = OnceLock::new();

/// Starts the log worker before proxy traffic resumes; SQLite is opened only by that worker.
pub(crate) fn setup<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if SERVICE.get().is_some() {
        return Ok(());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| LogError::Unavailable.to_string())?
        .join(DATABASE_FILENAME);
    let service = LogService::start(path).map_err(|error| error.to_string())?;
    SERVICE
        .set(service)
        .map_err(|_| LogError::Unavailable.to_string())
}

/// Accepts display-safe summaries only; request bodies, authentication and headers must never be passed here.
pub(crate) fn record_proxy_error(message: &str, status_code: Option<u16>) {
    if let Some(service) = SERVICE.get() {
        service.record_proxy(message, status_code);
    }
}

/// Queue installer diagnostics without blocking the UI; the worker redacts sensitive values.
pub(crate) fn record_codex_error(message: &str) {
    if let Some(service) = SERVICE.get() {
        service.record_codex(message);
    } else {
        eprintln!("{}", sanitize_diagnostic_message(message));
    }
}

fn service() -> Result<&'static LogService, LogError> {
    SERVICE.get().ok_or(LogError::Unavailable)
}

/// Reuses the error log redaction policy for diagnostic summaries and upstream failures.
pub(crate) fn sanitize_diagnostic_message(message: &str) -> String {
    sanitize::message(message).unwrap_or_default()
}

/// Returns a bounded snapshot after preceding queued writes, entirely on the database worker.
pub(crate) fn export_proxy_errors() -> Result<ErrorLogPage, String> {
    service()
        .and_then(|service| {
            service.list(ListQuery {
                limit: models::MAX_ENTRIES as u32,
                before_id: None,
                source: Some(ErrorLogSource::Proxy),
                offset: 0,
                snapshot_id: None,
            })
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn list_error_logs(
    limit: Option<u32>,
    before_id: Option<i64>,
    source: Option<ErrorLogSource>,
    pagination: Option<ErrorLogPagination>,
) -> Result<ErrorLogPage, String> {
    let query = ListQuery::new(limit, before_id, source)
        .and_then(|query| query.with_pagination(pagination))
        .map_err(|error| error.to_string())?;
    background(move || service()?.list(query)).await
}

#[tauri::command]
pub(crate) async fn clear_error_logs() -> Result<(), String> {
    background(|| service()?.clear()).await
}

#[tauri::command]
pub(crate) async fn record_toast_log(message: String) -> Result<(), String> {
    background(move || service()?.record_toast(&message)).await
}

async fn background<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, LogError> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| LogError::Unavailable.to_string())?
        .map_err(|error| error.to_string())
}
