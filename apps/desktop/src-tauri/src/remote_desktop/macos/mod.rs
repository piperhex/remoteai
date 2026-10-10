//! macOS uses Quartz coordinates for input and ScreenCaptureKit pixels for video.
mod events;
pub(super) mod input;
pub(super) mod monitors;
pub(super) mod pasteboard;

use super::{DesktopError, Result};

pub(super) fn authorize_open(control: bool) -> Result<()> {
    use crate::computer_use::permissions::Permission;
    let result = authorize(control);
    let permission = match &result {
        Err(DesktopError::ScreenPermission) => Some(Permission::ScreenRecording),
        Err(DesktopError::InputPermission) => Some(Permission::Accessibility),
        _ => None,
    };
    if let Some(permission) = permission {
        super::permission_prompt::request_once(permission);
    }
    result
}

pub(super) fn authorize(control: bool) -> Result<()> {
    let status = crate::computer_use::permissions::status().ok_or(DesktopError::MacVersion)?;
    if !status.screen_recording {
        return Err(DesktopError::ScreenPermission);
    }
    if control && !status.accessibility {
        return Err(DesktopError::InputPermission);
    }
    Ok(())
}
