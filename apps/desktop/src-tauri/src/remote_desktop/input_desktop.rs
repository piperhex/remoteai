//! Only the installed SYSTEM worker may bind a blocking thread to the active secure desktop.
use super::{DesktopError, Result};
use std::sync::atomic::{AtomicBool, Ordering};
use windows_sys::Win32::System::{StationsAndDesktops::*, Threading::GetCurrentThreadId};

static WORKER: AtomicBool = AtomicBool::new(false);
pub(crate) fn enable_worker() {
    WORKER.store(true, Ordering::Relaxed);
}
pub(super) fn is_worker() -> bool {
    WORKER.load(Ordering::Relaxed)
}
pub(super) struct InputDesktop {
    previous: HDESK,
    current: HDESK,
}
impl InputDesktop {
    pub fn enter() -> Result<Option<Self>> {
        if !WORKER.load(Ordering::Relaxed) {
            return Ok(None);
        }
        Self::bind().map(Some)
    }

    fn bind() -> Result<Self> {
        // SAFETY: the new desktop is owned by this scope; the previous desktop is borrowed from this thread.
        unsafe {
            let previous = GetThreadDesktop(GetCurrentThreadId());
            let current = OpenInputDesktop(
                0,
                0,
                // SendInput also requires JOURNALPLAYBACK, even though no journal hook is installed.
                DESKTOP_READOBJECTS
                    | DESKTOP_WRITEOBJECTS
                    | DESKTOP_CREATEWINDOW
                    | DESKTOP_JOURNALPLAYBACK,
            );
            if current.is_null() {
                return Err(DesktopError::Platform);
            }
            if SetThreadDesktop(current) == 0 {
                if CloseDesktop(current) == 0 {
                    eprintln!("desktop handle cleanup failed");
                }
                return Err(DesktopError::Platform);
            }
            Ok(Self { previous, current })
        }
    }
}

impl Drop for InputDesktop {
    fn drop(&mut self) {
        // SAFETY: the scope never crosses a thread or await boundary; restore before closing our owned handle.
        unsafe {
            if SetThreadDesktop(self.previous) == 0 {
                eprintln!("desktop thread restore failed");
            }
            if CloseDesktop(self.current) == 0 {
                eprintln!("desktop handle cleanup failed");
            }
        }
    }
}

#[cfg(test)]
#[path = "input_desktop_tests.rs"]
mod tests;
