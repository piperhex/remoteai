use super::*;

#[derive(Debug, thiserror::Error)]
#[error("failed to unpack archive entry")]
struct ArchiveError(#[source] io::Error);

#[test]
fn only_confirmed_storage_errors_report_insufficient_space() {
    for kind in [
        io::ErrorKind::StorageFull,
        io::ErrorKind::PermissionDenied,
        io::ErrorKind::InvalidData,
        io::ErrorKind::NotFound,
        io::ErrorKind::Other,
    ] {
        let mapped = io(
            "extract archive entry",
            io::Error::from(kind),
            GuiError::InstallUnpack,
        );
        assert_eq!(
            matches!(mapped, GuiError::InstallDiskFull),
            kind == io::ErrorKind::StorageFull
        );
    }
    assert!(matches!(
        classify(&io::ErrorKind::PermissionDenied.into()),
        Some(GuiError::InstallPermission)
    ));
    assert!(matches!(
        classify(&io::ErrorKind::ReadOnlyFilesystem.into()),
        Some(GuiError::InstallPermission)
    ));
}

#[test]
fn nested_archive_errors_preserve_the_cause_and_hide_it_from_install_prompts() {
    let error = io::Error::other(ArchiveError(io::Error::new(
        io::ErrorKind::StorageFull,
        "disk full while writing C:\\private\\codex.exe",
    )));
    assert!(details(&error).contains("disk full while writing"));
    let mapped = io("extract archive entry", error, GuiError::InstallUnpack);
    assert!(matches!(mapped, GuiError::InstallDiskFull));
    assert!(!mapped.to_string().contains("private"));
}

#[cfg(windows)]
#[test]
fn windows_disk_full_and_file_locks_are_distinct_even_inside_tar_errors() {
    use windows_sys::Win32::Foundation::{
        ERROR_DISK_FULL, ERROR_HANDLE_DISK_FULL, ERROR_LOCK_VIOLATION, ERROR_SHARING_VIOLATION,
    };
    for code in [
        ERROR_DISK_FULL,
        ERROR_HANDLE_DISK_FULL,
        ERROR_LOCK_VIOLATION,
        ERROR_SHARING_VIOLATION,
    ] {
        let original = io::Error::from_raw_os_error(code as i32);
        let wrapped = io::Error::new(original.kind(), ArchiveError(original));
        let mapped = io("extract archive entry", wrapped, GuiError::InstallUnpack);
        assert_eq!(
            matches!(mapped, GuiError::InstallDiskFull),
            matches!(code, ERROR_DISK_FULL | ERROR_HANDLE_DISK_FULL)
        );
        assert_eq!(
            matches!(mapped, GuiError::InstallInUse),
            matches!(code, ERROR_LOCK_VIOLATION | ERROR_SHARING_VIOLATION)
        );
    }
}
