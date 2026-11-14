//! Bounded unpacking for user-selected ZIP/CRX packages and unpacked extension folders.
use super::{manifest, Error, Result};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

pub(super) struct Prepared {
    pub path: PathBuf,
    _temporary: Option<tempfile::TempDir>,
}

pub(super) fn relative(value: &str) -> Result<PathBuf> {
    let path = Path::new(value);
    if value.is_empty()
        || value.contains(['\\', ':'])
        || value.ends_with(['.', ' '])
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(Error::Invalid);
    }
    Ok(path.to_owned())
}

fn extension_root(path: &Path) -> Result<PathBuf> {
    if path.join("manifest.json").is_file() {
        return Ok(path.to_owned());
    }
    let children = fs::read_dir(path)
        .map_err(|_| Error::Invalid)?
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|_| Error::Invalid)?;
    let directories: Vec<_> = children
        .iter()
        .filter(|entry| entry.path().is_dir())
        .collect();
    if children.len() == 1
        && directories.len() == 1
        && directories[0].path().join("manifest.json").is_file()
    {
        return Ok(directories[0].path());
    }
    Err(Error::Invalid)
}

pub(super) fn prepare(source: &Path) -> Result<Prepared> {
    let source = source.canonicalize().map_err(|_| Error::Invalid)?;
    if source.is_dir() {
        let path = extension_root(&source)?;
        manifest::read(&path)?;
        return Ok(Prepared {
            path,
            _temporary: None,
        });
    }
    if source
        .file_name()
        .is_some_and(|name| name == "manifest.json")
    {
        return prepare(source.parent().ok_or(Error::Invalid)?);
    }
    let suffix = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !suffix.eq_ignore_ascii_case("zip") && !suffix.eq_ignore_ascii_case("crx") {
        return Err(Error::Invalid);
    }
    if fs::metadata(&source).map_err(|_| Error::Invalid)?.len() > manifest::MAX_EXTENSION_BYTES {
        return Err(Error::Invalid);
    }
    let temporary = tempfile::tempdir().map_err(|_| Error::Storage)?;
    extract(&source, temporary.path())?;
    let path = extension_root(temporary.path())?;
    manifest::read(&path)?;
    Ok(Prepared {
        path,
        _temporary: Some(temporary),
    })
}

fn extract(source: &Path, destination: &Path) -> Result<()> {
    // ZipArchive accounts for a CRX/self-extracting prefix using the central directory offsets.
    let file = fs::File::open(source).map_err(|_| Error::Invalid)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| Error::Invalid)?;
    if archive.len() > manifest::MAX_EXTENSION_FILES {
        return Err(Error::Invalid);
    }
    let mut bytes = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| Error::Invalid)?;
        let relative = relative(entry.name().trim_end_matches('/'))?;
        if entry.is_symlink() {
            return Err(Error::Invalid);
        }
        bytes = bytes.checked_add(entry.size()).ok_or(Error::Invalid)?;
        if bytes > manifest::MAX_EXTENSION_BYTES {
            return Err(Error::Invalid);
        }
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|_| Error::Storage)?;
            continue;
        }
        fs::create_dir_all(target.parent().ok_or(Error::Invalid)?).map_err(|_| Error::Storage)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|_| Error::Invalid)?;
        let size = entry.size();
        let copied = std::io::copy(&mut (&mut entry).take(size + 1), &mut output)
            .map_err(|_| Error::Invalid)?;
        if copied != size {
            return Err(Error::Invalid);
        }
    }
    Ok(())
}

pub(super) fn export(source: &Path, target: &Path) -> Result<u64> {
    let prepared = prepare(source)?;
    let snapshot = tempfile::tempdir().map_err(|_| Error::Storage)?;
    let root = snapshot.path().join("extension");
    manifest::copy(&prepared.path, &root)?;
    let file = fs::File::create(target).map_err(|_| Error::Storage)?;
    let mut archive = zip::ZipWriter::new(file);
    let mut queue = vec![root.clone()];
    while let Some(folder) = queue.pop() {
        for entry in fs::read_dir(folder).map_err(|_| Error::Storage)? {
            let path = entry.map_err(|_| Error::Storage)?.path();
            if path.is_dir() {
                queue.push(path);
                continue;
            }
            let name = path
                .strip_prefix(&root)
                .map_err(|_| Error::Invalid)?
                .to_string_lossy()
                .replace('\\', "/");
            archive
                .start_file(name, zip::write::SimpleFileOptions::default())
                .map_err(|_| Error::Storage)?;
            std::io::copy(
                &mut fs::File::open(path).map_err(|_| Error::Storage)?,
                &mut archive,
            )
            .map_err(|_| Error::Storage)?;
        }
    }
    let mut file = archive.finish().map_err(|_| Error::Storage)?;
    file.flush().map_err(|_| Error::Storage)?;
    let size = file.metadata().map_err(|_| Error::Storage)?.len();
    if size > manifest::MAX_EXTENSION_BYTES {
        return Err(Error::Invalid);
    }
    Ok(size)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zip_and_prefixed_crx_round_trip_and_reject_escaping_entries() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(
            source.join("manifest.json"),
            r#"{"manifest_version":3,"name":"test","version":"1"}"#,
        )
        .unwrap();
        let zip = temp.path().join("extension.zip");
        export(&source, &zip).unwrap();
        assert_eq!(
            manifest::read(&prepare(&zip).unwrap().path).unwrap().name,
            "test"
        );
        let mut crx = b"Cr24\x03\0\0\0\0\0\0\0".to_vec();
        crx.extend(fs::read(&zip).unwrap());
        let crx_path = temp.path().join("extension.crx");
        fs::write(&crx_path, crx).unwrap();
        assert!(prepare(&crx_path).is_ok());
        for path in [
            "../escape",
            "/absolute",
            "C:/file",
            "folder\\file",
            "file:stream",
        ] {
            assert!(relative(path).is_err());
        }
        let mut malicious = zip::ZipWriter::new(fs::File::create(&zip).unwrap());
        malicious
            .start_file("../escape", zip::write::SimpleFileOptions::default())
            .unwrap();
        malicious.write_all(b"escape").unwrap();
        malicious.finish().unwrap();
        assert!(prepare(&zip).is_err());
        assert!(!temp.path().join("escape").exists());
    }
}
