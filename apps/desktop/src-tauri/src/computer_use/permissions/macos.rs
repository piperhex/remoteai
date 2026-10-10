use super::{
    repair::{reset_command, RepairState},
    Permission, Permissions, RepairResult,
};
use crate::computer_use::{ComputerError, Result};
use core_foundation::{
    base::TCFType,
    boolean::CFBoolean,
    bundle::CFBundle,
    dictionary::CFDictionary,
    string::{CFString, CFStringRef},
};
use std::{ffi::c_void, process::Command, sync::OnceLock};

const MINIMUM_MACOS_MAJOR: u32 = 13;
static REPAIRS: RepairState = RepairState::new();
const ACCESSIBILITY_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
const SCREEN_RECORDING_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    static kAXTrustedCheckOptionPrompt: CFStringRef;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {}

pub(in crate::computer_use) fn supported() -> bool {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        sysinfo::System::os_version()
            .and_then(|version| version.split('.').next()?.parse::<u32>().ok())
            .is_some_and(|major| major >= MINIMUM_MACOS_MAJOR)
    })
}

pub(super) fn status() -> Permissions {
    let mut permissions = Permissions {
        // SAFETY: Apple's AX preflight API takes no pointers and is available on all supported hosts.
        accessibility: unsafe { AXIsProcessTrusted() },
        screen_recording: screen_capture_access(false),
        restart_required: Vec::new(),
    };
    REPAIRS.apply(&mut permissions);
    permissions
}

pub(super) fn repair(permission: Permission) -> Result<RepairResult> {
    REPAIRS.repair(permission, || reset(permission), || request(permission))
}

fn reset(permission: Permission) -> Result<()> {
    let result = reset_command(permission)
        .output()
        .map_err(|_| ComputerError::PermissionReset)?;
    if !result.status.success() {
        return Err(ComputerError::PermissionReset);
    }
    Ok(())
}

pub(super) fn request(permission: Permission) -> Result<()> {
    let url = match permission {
        Permission::Accessibility => {
            request_accessibility();
            ACCESSIBILITY_SETTINGS
        }
        Permission::ScreenRecording => {
            // A false result is a pending/denied grant, not a launch error; polling reads the actual status.
            screen_capture_access(true);
            SCREEN_RECORDING_SETTINGS
        }
    };
    let status = Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|_| ComputerError::Permissions)?;
    if !status.success() {
        return Err(ComputerError::Permissions);
    }
    Ok(())
}

fn screen_capture_access(request: bool) -> bool {
    // Resolve the 10.15+ APIs at runtime so this optional feature does not prevent the main app
    // from launching on older macOS versions supported by the existing bundle configuration.
    let Some(bundle) = CFBundle::bundle_with_identifier(CFString::new("com.apple.CoreGraphics"))
    else {
        return false;
    };
    let name = if request {
        "CGRequestScreenCaptureAccess"
    } else {
        "CGPreflightScreenCaptureAccess"
    };
    let pointer = bundle.function_pointer_for_name(CFString::new(name));
    if pointer.is_null() {
        return false;
    }
    // SAFETY: Both fixed CoreGraphics symbols have the C signature bool(void). The framework and
    // retained bundle stay loaded throughout this call; null pointers are rejected above.
    unsafe { std::mem::transmute::<*const c_void, unsafe extern "C" fn() -> bool>(pointer)() }
}

fn request_accessibility() {
    // SAFETY: Apple's immutable CFString constant is retained under the Get rule; the dictionary stays
    // alive throughout the AX call. A denied/pending grant is intentionally left for status polling.
    unsafe {
        let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
        let options = CFDictionary::from_CFType_pairs(&[(
            key.as_CFType(),
            CFBoolean::true_value().as_CFType(),
        )]);
        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef().cast());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_hosts_expose_the_screen_permission_apis_without_requesting_access() {
        if !supported() {
            return;
        }
        let bundle =
            CFBundle::bundle_with_identifier(CFString::new("com.apple.CoreGraphics")).unwrap();
        for name in [
            "CGPreflightScreenCaptureAccess",
            "CGRequestScreenCaptureAccess",
        ] {
            assert!(!bundle
                .function_pointer_for_name(CFString::new(name))
                .is_null());
        }
    }
}
