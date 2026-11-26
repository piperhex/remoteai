//! Opt-in, offline synchronization of machine-local Codex project section membership.
mod identity;
mod membership;
mod store;

use std::path::Path;

use serde_json::Value;

const OWNER_PREFIX: &str = "electron-owner-atoms:";
const SECTION_KEY: &str = "sidebar-custom-sections-v3";

#[derive(Debug, thiserror::Error)]
pub(crate) enum SyncError {
    #[error("sidebar_sync_storage")]
    Database(#[from] rusqlite::Error),
    #[error("sidebar_sync_json")]
    Json(#[from] serde_json::Error),
    #[error("sidebar_sync_backup")]
    Io(#[from] std::io::Error),
    #[error("sidebar_sync_schema")]
    Schema,
}

/// The caller must hold the account-switch lock and ensure the desktop is stopped.
/// Missing databases, unsupported identities and empty source layouts are no-ops.
pub(crate) fn sync(home: &Path, previous: &Value, selected: &Value) -> Result<usize, SyncError> {
    let (Some(source), Some(target)) = (
        identity::Identity::from_auth(previous),
        identity::Identity::from_auth(selected),
    ) else {
        return Ok(0);
    };
    if source == target {
        return Ok(0);
    }
    store::sync(home, &source, &target)
}

#[cfg(test)]
mod tests;
