use super::{
    automatic, install, package, permissions, platform, state, ComputerError, Result, CHANGES,
    VERSION,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComputerUseStatus {
    installed: bool,
    enabled: bool,
    needs_repair: bool,
    supported: bool,
    version: &'static str,
    permissions: Option<permissions::Permissions>,
    #[cfg(windows)]
    administrator: super::administrator::Status,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ComputerUseAction {
    Install,
    Enable,
    Disable,
    Remove,
    EnableAdministrator,
    GrantAdministrator,
    RevokeAdministrator,
}

#[tauri::command]
pub(crate) async fn computer_use_request_permission(
    permission: permissions::Permission,
) -> std::result::Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || permissions::request(permission))
        .await
        .map_err(|_| ComputerError::Permissions.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn computer_use_status(
    app: tauri::AppHandle,
    home_id: String,
) -> std::result::Result<ComputerUseStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Read a completed installation, never a partially written record/config pair.
        let _guard = CHANGES.lock().map_err(|_| ComputerError::Storage)?;
        let home = crate::codex_home::resolve_selected(&app, Some(&home_id))
            .map_err(|_| ComputerError::Storage)?;
        let root = super::root()?;
        if platform::asset().is_ok() {
            match install::refresh_installed(&root, &home) {
                Ok(()) | Err(ComputerError::Conflict) => {}
                Err(error) => return Err(error),
            }
        }
        status(&root, &home)
    })
    .await
    .map_err(|_| ComputerError::Storage.to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn computer_use_action(
    app: tauri::AppHandle,
    home_id: String,
    action: ComputerUseAction,
) -> std::result::Result<ComputerUseStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        platform::asset()?;
        let home = crate::codex_home::resolve_selected(&app, Some(&home_id))
            .map_err(|_| ComputerError::Storage)?;
        let root = super::root()?;
        if matches!(
            action,
            ComputerUseAction::EnableAdministrator
                | ComputerUseAction::GrantAdministrator
                | ComputerUseAction::RevokeAdministrator
        ) {
            #[cfg(windows)]
            {
                if matches!(action, ComputerUseAction::EnableAdministrator) {
                    super::administrator::request(&root, &home)?;
                } else if matches!(action, ComputerUseAction::GrantAdministrator) {
                    super::administrator::enable(&root, &home)?;
                } else {
                    super::administrator::revoke(&root, &home)?;
                }
                return status(&root, &home);
            }
            #[cfg(not(windows))]
            return Err(ComputerError::Unsupported);
        }
        let _guard = CHANGES.lock().map_err(|_| ComputerError::Storage)?;
        automatic::remember(&root, &home)?;
        match action {
            ComputerUseAction::Install | ComputerUseAction::Enable => {
                install::install(&app, &root, &home)?
            }
            ComputerUseAction::Disable => install::disable(&root, &home, false)?,
            ComputerUseAction::Remove => install::disable(&root, &home, true)?,
            ComputerUseAction::EnableAdministrator
            | ComputerUseAction::GrantAdministrator
            | ComputerUseAction::RevokeAdministrator => {
                return Err(ComputerError::Unsupported);
            }
        }
        status(&root, &home)
    })
    .await
    .map_err(|_| ComputerError::Storage.to_string())?
    .map_err(|error| error.to_string())
}

fn status(root: &Path, home: &Path) -> Result<ComputerUseStatus> {
    let supported = platform::asset().is_ok();
    let record = state::read(root, &state::home_id(home))?;
    let requested = record.as_ref().is_some_and(|record| record.enabled);
    let needs_repair = if record.is_some() && supported {
        !package::present(root)?
            || !install::configured(home, requested)?
            || (requested && !install::skill_matches(home))
    } else {
        false
    };
    Ok(ComputerUseStatus {
        installed: record.is_some(),
        enabled: requested && !needs_repair,
        needs_repair,
        supported,
        version: VERSION,
        permissions: permissions::status(),
        #[cfg(windows)]
        administrator: super::administrator::status(root, home)?,
    })
}
