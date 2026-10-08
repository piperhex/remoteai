//! Installer failures retain their original causes in diagnostics, never in user-facing copy.
use super::GuiError;
use std::{error::Error, io};

const MAX_CAUSES: usize = 16;

/// Log the full error chain before replacing it with actionable, display-safe copy.
pub(super) fn failure(step: &str, error: &dyn Error, fallback: GuiError) -> GuiError {
    record(step, &details(error));
    fallback
}

/// Record validation failures that have no underlying operating-system error.
pub(super) fn invalid(step: &str, reason: &str, fallback: GuiError) -> GuiError {
    record(step, reason);
    fallback
}

pub(super) fn io(step: &str, error: io::Error, fallback: GuiError) -> GuiError {
    let category = classify(&error).unwrap_or(fallback);
    failure(step, &error, category)
}

fn record(step: &str, details: &str) {
    crate::error_logs::record_codex_error(&format!("Codex CLI [{step}]: {details}"));
}

fn details(error: &dyn Error) -> String {
    let mut parts = vec![error.to_string()];
    let mut cause = error.source();
    for _ in 0..MAX_CAUSES {
        let Some(error) = cause else { break };
        parts.push(error.to_string());
        cause = error.source();
    }
    parts.join("; caused by: ")
}

fn classify(error: &io::Error) -> Option<GuiError> {
    let mut cause: Option<&(dyn Error + 'static)> = Some(error);
    let mut fallback = None;
    for _ in 0..MAX_CAUSES {
        let Some(current) = cause else { break };
        if let Some(error) = current.downcast_ref::<io::Error>() {
            if let Some(category) = os_category(error) {
                return Some(category);
            }
            match error.kind() {
                io::ErrorKind::StorageFull => return Some(GuiError::InstallDiskFull),
                io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem => {
                    fallback = Some(GuiError::InstallPermission);
                }
                io::ErrorKind::ExecutableFileBusy | io::ErrorKind::ResourceBusy => {
                    fallback = Some(GuiError::InstallInUse);
                }
                _ => {}
            }
            // io::Error::source can skip the wrapper; tar carries the OS error inside it.
            cause = error.get_ref().map(|inner| inner as &dyn Error);
        } else {
            cause = current.source();
        }
    }
    fallback
}

#[cfg(windows)]
fn os_category(error: &io::Error) -> Option<GuiError> {
    use windows_sys::Win32::Foundation::{
        ERROR_DISK_FULL, ERROR_HANDLE_DISK_FULL, ERROR_LOCK_VIOLATION, ERROR_SHARING_VIOLATION,
    };
    match error.raw_os_error().map(|code| code as u32) {
        Some(ERROR_DISK_FULL | ERROR_HANDLE_DISK_FULL) => Some(GuiError::InstallDiskFull),
        Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION) => Some(GuiError::InstallInUse),
        _ => None,
    }
}

#[cfg(not(windows))]
fn os_category(_error: &io::Error) -> Option<GuiError> {
    None
}

#[cfg(test)]
#[path = "release_error_tests.rs"]
mod tests;
