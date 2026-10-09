//! Copy complete packages without renaming directories that Windows scanners may have open.
use super::{entrypoint, errors, GuiError, Result};
use std::{fs, io, path::Path};

const INCOMPLETE_MARKER: &str = ".codex-installing";

/// Older packages have no marker; new copies remain unavailable until every file is in place.
pub(super) fn ready(destination: &Path) -> bool {
    destination.join(entrypoint()).is_file()
        && matches!(destination.join(INCOMPLETE_MARKER).try_exists(), Ok(false))
}

/// Call with the package publication guard held, without holding the metadata guard.
pub(super) fn directory(staging: &Path, destination: &Path) -> Result<()> {
    if staging.join(INCOMPLETE_MARKER).exists() {
        return Err(GuiError::Integrity);
    }
    ensure_directory(destination).map_err(|error| {
        errors::io(
            "create package directory",
            error,
            GuiError::InstallDirectory,
        )
    })?;
    let marker = destination.join(INCOMPLETE_MARKER);
    begin_copy(&marker)
        .map_err(|error| errors::io("mark incomplete package", error, GuiError::InstallWrite))?;
    copy_directory(staging, destination)
        .map_err(|error| errors::io("copy installed package", error, GuiError::InstallWrite))?;
    fs::remove_file(marker)
        .map_err(|error| errors::io("complete installed package", error, GuiError::InstallWrite))?;
    Ok(())
}

fn begin_copy(marker: &Path) -> io::Result<()> {
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(marker)
    {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => ensure_regular_file(marker),
        Err(error) => Err(error),
    }
}

fn ensure_directory(path: &Path) -> io::Result<()> {
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            if fs::symlink_metadata(path)?.file_type().is_dir() {
                Ok(())
            } else {
                Err(io::ErrorKind::AlreadyExists.into())
            }
        }
        Err(error) => Err(error),
    }
}

fn ensure_regular_file(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path)?.file_type().is_file() {
        Ok(())
    } else {
        Err(io::ErrorKind::InvalidData.into())
    }
}

fn copy_directory(source: &Path, destination: &Path) -> io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            ensure_directory(&target)?;
            copy_directory(&entry.path(), &target)?;
        } else if kind.is_file() {
            copy_file(&entry.path(), &target)?;
        } else {
            return Err(io::ErrorKind::InvalidData.into());
        }
    }
    Ok(())
}

fn copy_file(source: &Path, destination: &Path) -> io::Result<()> {
    // Never follow links left in an interrupted destination.
    match fs::symlink_metadata(destination) {
        Ok(_) => ensure_regular_file(destination)?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    fs::copy(source, destination).map(|_| ())
}

#[cfg(test)]
#[path = "release_publish_tests.rs"]
mod tests;
