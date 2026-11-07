use std::path::Path;
use tokio::process::Command;

/// Enumerate assigned drive letters without opening potentially unavailable volumes.
pub(super) fn directory_roots() -> Vec<std::path::PathBuf> {
    #[cfg(windows)]
    {
        // SAFETY: GetLogicalDrives takes no pointers and returns the process's drive bitmask.
        let drives = unsafe { windows_sys::Win32::Storage::FileSystem::GetLogicalDrives() };
        (b'A'..=b'Z')
            .filter(|letter| drives & (1 << (letter - b'A')) != 0)
            .map(|letter| std::path::PathBuf::from(format!("{}:\\", char::from(letter))))
            .collect()
    }
    #[cfg(not(windows))]
    vec![std::path::PathBuf::from("/")]
}

/// Resolve shortcuts without checking redirected folders over a network connection.
pub(super) fn directory_shortcuts() -> [Option<std::path::PathBuf>; 4] {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Shell::{
            FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Profile,
        };
        [
            FOLDERID_Profile,
            FOLDERID_Desktop,
            FOLDERID_Downloads,
            FOLDERID_Documents,
        ]
        .map(|id| known_folder(&id))
    }
    #[cfg(not(windows))]
    [
        dirs::home_dir(),
        dirs::desktop_dir(),
        dirs::download_dir(),
        dirs::document_dir(),
    ]
}

#[cfg(windows)]
fn known_folder(id: &windows::core::GUID) -> Option<std::path::PathBuf> {
    use std::{ffi::OsString, os::windows::ffi::OsStringExt};
    use windows::Win32::{
        System::Com::CoTaskMemFree,
        UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DONT_VERIFY},
    };
    // SAFETY: the OS returns a NUL-terminated allocation; copy it before freeing with its allocator.
    unsafe {
        let value = SHGetKnownFolderPath(id, KF_FLAG_DONT_VERIFY, None).ok()?;
        let path = std::path::PathBuf::from(OsString::from_wide(value.as_wide()));
        CoTaskMemFree(Some(value.0.cast()));
        Some(path)
    }
}

pub(super) fn execution_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
    }
    #[cfg(not(windows))]
    value.into_owned()
}

pub(super) fn comparable_path(path: &str) -> String {
    #[cfg(windows)]
    {
        let path = execution_path(Path::new(path)).replace('\\', "/");
        path.strip_prefix("//?/")
            .unwrap_or(&path)
            .trim_end_matches('/')
            .to_lowercase()
    }
    #[cfg(not(windows))]
    path.trim_end_matches('/').to_owned()
}

pub(super) fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW: CLI transport must not open a console.
    #[cfg(not(windows))]
    let _ = command;
}

pub(super) fn hide_git_window(command: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW for background Git operations.
    }
    #[cfg(not(windows))]
    let _ = command;
}
