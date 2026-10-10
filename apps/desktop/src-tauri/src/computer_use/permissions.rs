//! Host-owned macOS permission UX. Polling never prompts or launches a driver.
use super::{ComputerError, Result};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
#[path = "permissions/macos.rs"]
mod macos;
#[cfg(any(target_os = "macos", test))]
mod repair;
#[cfg(target_os = "macos")]
pub(super) use macos::supported as supported_macos;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Permissions {
    pub(crate) accessibility: bool,
    pub(crate) screen_recording: bool,
    pub(crate) restart_required: Vec<Permission>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Permission {
    Accessibility,
    ScreenRecording,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepairResult {
    pub(crate) settings_opened: bool,
}

/// Reset only the permission explicitly selected in the local Mac settings.
pub(crate) fn repair(permission: Permission) -> Result<RepairResult> {
    #[cfg(target_os = "macos")]
    if macos::supported() {
        return macos::repair(permission);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = permission; // System privacy repair is available only on macOS.
    Err(ComputerError::Unsupported)
}

pub(crate) fn status() -> Option<Permissions> {
    #[cfg(target_os = "macos")]
    if macos::supported() {
        return Some(macos::status());
    }
    None
}

pub(crate) fn request(permission: Permission) -> Result<()> {
    #[cfg(target_os = "macos")]
    if macos::supported() {
        return macos::request(permission);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = permission; // Only macOS has this permission flow.
    Err(ComputerError::Unsupported)
}
