//! Atomic same-directory replacement. Never unlink the old ledger before the new one is durable.
use std::{io, path::Path};
use tempfile::NamedTempFile;

#[cfg(not(windows))]
pub(super) fn replace(temporary: NamedTempFile, destination: &Path) -> io::Result<()> {
    temporary
        .persist(destination)
        .map_err(|error| error.error)?;
    // fsync of a file does not persist its directory entry on Unix.
    std::fs::File::open(
        destination
            .parent()
            .ok_or_else(|| io::Error::other("missing parent"))?,
    )?
    .sync_all()
}

#[cfg(windows)]
pub(super) fn replace(temporary: NamedTempFile, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, SetFileAttributesW, FILE_ATTRIBUTE_NORMAL, MOVEFILE_REPLACE_EXISTING,
        MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = temporary
        .path()
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Clear tempfile's temporary attribute before publication, just as NamedTempFile::persist does.
    // SAFETY: source is a live NUL-terminated path owned by temporary.
    if unsafe { SetFileAttributesW(source.as_ptr(), FILE_ATTRIBUTE_NORMAL) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: both paths are live, NUL-terminated UTF-16 buffers for the duration of this call.
    // The temp file is in the same directory; cross-volume copy fallback is deliberately disabled.
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        return Err(io::Error::last_os_error());
    }
    // NamedTempFile's cleanup now targets a nonexistent old name, not the new ledger.
    Ok(())
}
