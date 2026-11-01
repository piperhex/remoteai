//! Canonical file claims serialize aliases, while tree mutations claim their whole subtree.
use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Condvar, OnceLock,
};
use std::time::Duration;

#[derive(Default)]
struct Claims {
    active: Vec<(u64, PathBuf, bool)>,
    next: u64,
}

static CLAIMS: OnceLock<(Mutex<Claims>, Condvar)> = OnceLock::new();

pub(in crate::codex_gui) struct Guard(u64);

fn registry() -> &'static (Mutex<Claims>, Condvar) {
    CLAIMS.get_or_init(|| (Mutex::new(Claims::default()), Condvar::new()))
}

fn identity(path: &Path) -> PathBuf {
    // canonicalize resolves symlinks and Windows short names before this function is called.
    #[cfg(windows)]
    {
        PathBuf::from(path.as_os_str().to_string_lossy().to_lowercase())
    }
    #[cfg(not(windows))]
    {
        path.to_owned()
    }
}

pub(in crate::codex_gui) fn acquire(path: &Path, tree: bool) -> Result<Guard> {
    acquire_cancellable(path, tree, None)
}

pub(super) fn acquire_cancellable(
    path: &Path,
    tree: bool,
    cancelled: Option<&AtomicBool>,
) -> Result<Guard> {
    let key = identity(path);
    let (mutex, changed) = registry();
    let mut claims = mutex.lock().map_err(|_| GuiError::FileBusy)?;
    while claims.active.iter().any(|(_, other, subtree)| {
        key == *other || (*subtree && key.starts_with(other)) || (tree && other.starts_with(&key))
    }) {
        if cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            return Err(GuiError::FileExpired);
        }
        claims = changed
            .wait_timeout(claims, Duration::from_millis(50))
            .map_err(|_| GuiError::FileBusy)?
            .0;
    }
    claims.next = claims.next.wrapping_add(1);
    let id = claims.next;
    claims.active.push((id, key, tree));
    Ok(Guard(id))
}

impl Drop for Guard {
    fn drop(&mut self) {
        let (mutex, changed) = registry();
        // Recovery only releases an existing claim; no file data is stored under this mutex.
        let mut claims = mutex.lock().unwrap_or_else(|error| error.into_inner());
        claims.active.retain(|(id, _, _)| *id != self.0);
        changed.notify_all();
    }
}

#[cfg(test)]
#[path = "locks_tests.rs"]
mod tests;
