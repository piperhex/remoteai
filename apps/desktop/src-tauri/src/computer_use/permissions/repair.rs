//! A reset invalidates cached grants until the host process restarts.
use super::{Permission, Permissions, RepairResult};
use crate::computer_use::{ComputerError, Result};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

const APP_BUNDLE_ID: &str = "dev.codex.switch";

pub(super) fn reset_command(permission: Permission) -> std::process::Command {
    let service = match permission {
        Permission::ScreenRecording => "ScreenCapture",
        Permission::Accessibility => "Accessibility",
    };
    // Never accept a shell command, service name or bundle identifier from the frontend.
    let mut command = std::process::Command::new("/usr/bin/tccutil");
    command.args(["reset", service, APP_BUNDLE_ID]);
    command
}

pub(super) struct RepairState {
    screen: AtomicBool,
    accessibility: AtomicBool,
    changes: Mutex<()>,
}

impl RepairState {
    pub(super) const fn new() -> Self {
        Self {
            screen: AtomicBool::new(false),
            accessibility: AtomicBool::new(false),
            changes: Mutex::new(()),
        }
    }

    fn pending(&self, permission: Permission) -> &AtomicBool {
        match permission {
            Permission::ScreenRecording => &self.screen,
            Permission::Accessibility => &self.accessibility,
        }
    }

    pub(super) fn repair(
        &self,
        permission: Permission,
        reset: impl FnOnce() -> Result<()>,
        request: impl FnOnce() -> Result<()>,
    ) -> Result<RepairResult> {
        let _guard = self
            .changes
            .try_lock()
            .map_err(|_| ComputerError::PermissionRepairBusy)?;
        let pending = self.pending(permission);
        if !pending.load(Ordering::Acquire) {
            reset()?;
            pending.store(true, Ordering::Release);
        }
        // Opening Settings can fail after a successful reset. Preserve that distinction so the
        // user is still told to reauthorize and restart, instead of repeatedly resetting consent.
        Ok(RepairResult {
            settings_opened: request().is_ok(),
        })
    }

    pub(super) fn apply(&self, permissions: &mut Permissions) {
        for permission in [Permission::ScreenRecording, Permission::Accessibility] {
            if !self.pending(permission).load(Ordering::Acquire) {
                continue;
            }
            permissions.restart_required.push(permission);
            match permission {
                Permission::ScreenRecording => permissions.screen_recording = false,
                Permission::Accessibility => permissions.accessibility = false,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn granted() -> Permissions {
        Permissions {
            screen_recording: true,
            accessibility: true,
            restart_required: vec![],
        }
    }

    #[test]
    fn reset_is_scoped_to_one_service_and_the_packaged_app_identity() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"].as_str(), Some(APP_BUNDLE_ID));
        for (permission, service) in [
            (Permission::ScreenRecording, "ScreenCapture"),
            (Permission::Accessibility, "Accessibility"),
        ] {
            let command = reset_command(permission);
            assert_eq!(command.get_program(), "/usr/bin/tccutil");
            let args: Vec<_> = command.get_args().collect();
            assert_eq!(args, ["reset", service, APP_BUNDLE_ID]);
        }
        for invalid in ["All", "ScreenCapture", "screenRecording; rm -rf /"] {
            assert!(serde_json::from_value::<Permission>(serde_json::json!(invalid)).is_err());
        }
    }

    #[test]
    fn reset_masks_only_the_selected_cached_grant_until_restart() {
        for permission in [Permission::ScreenRecording, Permission::Accessibility] {
            let state = RepairState::new();
            state.repair(permission, || Ok(()), || Ok(())).unwrap();
            let mut status = granted();
            state.apply(&mut status);
            assert_eq!(status.restart_required, vec![permission]);
            assert_eq!(
                status.screen_recording,
                permission != Permission::ScreenRecording
            );
            assert_eq!(
                status.accessibility,
                permission != Permission::Accessibility
            );
            let mut restarted = granted();
            RepairState::new().apply(&mut restarted);
            assert!(restarted.screen_recording && restarted.accessibility);
            assert!(restarted.restart_required.is_empty());
        }
    }

    #[test]
    fn failed_reset_keeps_grants_and_does_not_request_consent() {
        let state = RepairState::new();
        let result = state.repair(
            Permission::ScreenRecording,
            || Err(ComputerError::PermissionReset),
            || panic!("reset failed"),
        );
        assert!(matches!(result, Err(ComputerError::PermissionReset)));
        let mut status = granted();
        state.apply(&mut status);
        assert!(status.screen_recording && status.restart_required.is_empty());
    }

    #[test]
    fn settings_failure_preserves_reset_and_retry_does_not_reset_again() {
        let state = RepairState::new();
        let result = state
            .repair(
                Permission::ScreenRecording,
                || Ok(()),
                || Err(ComputerError::Permissions),
            )
            .unwrap();
        assert!(!result.settings_opened);
        let result = state
            .repair(
                Permission::ScreenRecording,
                || panic!("already reset"),
                || Ok(()),
            )
            .unwrap();
        assert!(result.settings_opened);
        let mut status = granted();
        state.apply(&mut status);
        assert!(!status.screen_recording);
    }

    #[test]
    fn concurrent_repair_is_rejected_without_running_a_second_reset() {
        let state = RepairState::new();
        state
            .repair(
                Permission::ScreenRecording,
                || {
                    let result = state.repair(
                        Permission::Accessibility,
                        || panic!("repair already running"),
                        || Ok(()),
                    );
                    assert!(matches!(result, Err(ComputerError::PermissionRepairBusy)));
                    Ok(())
                },
                || Ok(()),
            )
            .unwrap();
    }
}
