//! Automatic requests are once per permission and app run; the local settings button remains explicit.
use crate::computer_use::permissions::Permission;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
struct PermissionPrompts {
    screen: AtomicBool,
    accessibility: AtomicBool,
}

impl PermissionPrompts {
    fn claim(&self, permission: &Permission) -> bool {
        let requested = match permission {
            Permission::ScreenRecording => &self.screen,
            Permission::Accessibility => &self.accessibility,
        };
        !requested.swap(true, Ordering::Relaxed)
    }
}

#[cfg(target_os = "macos")]
pub(super) fn request_once(permission: Permission) {
    static PROMPTS: PermissionPrompts = PermissionPrompts {
        screen: AtomicBool::new(false),
        accessibility: AtomicBool::new(false),
    };
    if !PROMPTS.claim(&permission) {
        return;
    }
    // Do not hold the settings/capture lock or the opening RPC while the system presents its prompt.
    tauri::async_runtime::spawn_blocking(move || {
        if crate::computer_use::permissions::request(permission).is_err() {
            eprintln!("remote desktop: could not open Mac permission settings");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_retries_request_each_permission_only_once() {
        let prompts = PermissionPrompts::default();
        std::thread::scope(|scope| {
            let requests: Vec<_> = (0..16)
                .map(|_| scope.spawn(|| prompts.claim(&Permission::ScreenRecording)))
                .collect();
            let accepted = requests
                .into_iter()
                .map(|task| usize::from(task.join().unwrap()))
                .sum::<usize>();
            assert_eq!(accepted, 1);
        });
        assert!(prompts.claim(&Permission::Accessibility));
        assert!(!prompts.claim(&Permission::Accessibility));
        assert!(!prompts.claim(&Permission::ScreenRecording));
    }
}
