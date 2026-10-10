//! Resolution changes share the privacy transaction queue so capture cannot race display changes.
use crate::remote_desktop::{displays::Resolution, privacy, DesktopError, Result};

pub(super) fn authorize(id: &str, size: Resolution) -> Result<()> {
    crate::remote_desktop::with_session(id, |session| {
        if !session.permissions.control {
            return Err(DesktopError::Denied);
        }
        #[cfg(windows)]
        if crate::remote_desktop::resolutions::list(&session.display.info.id).contains(&size) {
            return Ok(());
        }
        #[cfg(not(windows))]
        let _ = size;
        Err(DesktopError::Resolution)
    })
}

pub(super) async fn apply(id: &str, size: Resolution) -> Result<privacy::Snapshot> {
    let id = id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        crate::remote_desktop::with_session(&id, |session| {
            if !session.permissions.control {
                return Err(DesktopError::Denied);
            }
            session.input.release()?;
            #[cfg(windows)]
            crate::remote_desktop::resolutions::apply(&session.display.info.id, size)?;
            #[cfg(not(windows))]
            {
                let _ = size;
                return Err(DesktopError::Resolution);
            }
            #[cfg(windows)]
            {
                let displays = crate::remote_desktop::monitors::list()?;
                session.display = displays
                    .into_iter()
                    .find(|display| display.info.id == session.display.info.id)
                    .ok_or(DesktopError::DisplayGone)?;
                privacy::snapshot(session)
            }
        })
    })
    .await
    .map_err(|_| DesktopError::Resolution)?
}
