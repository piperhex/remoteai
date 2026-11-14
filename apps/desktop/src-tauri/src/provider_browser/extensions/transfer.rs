//! Short-lived, bounded transfers keep dropped local files separate from remote filesystem paths.
use super::{manifest, package, Error, Request, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

const CHUNK_BYTES: usize = 192 * 1024;
const TRANSFER_LIFETIME: Duration = Duration::from_secs(15 * 60);
const MAX_TRANSFERS: usize = 4;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FileInfo {
    path: String,
    size: u64,
}
struct File {
    info: FileInfo,
    written: u64,
}
enum Kind {
    Upload(Vec<File>),
    Export(u64),
}
struct Transfer {
    directory: tempfile::TempDir,
    kind: Kind,
    touched: Instant,
}
static TRANSFERS: LazyLock<Mutex<HashMap<String, Transfer>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(super) fn execute(request: &Request) -> Option<Result<Value>> {
    let result = match request {
        Request::BeginUpload { files } => begin(files),
        Request::WriteUpload {
            token,
            path,
            offset,
            data,
        } => write(token, path, *offset, data),
        Request::Export { path } => export(path),
        Request::ReadExport { token, offset } => read(token, *offset),
        Request::ReleaseTransfer { token } => release(token),
        _ => return None,
    };
    Some(result)
}

fn insert(directory: tempfile::TempDir, kind: Kind) -> Result<String> {
    let mut transfers = TRANSFERS.lock().map_err(|_| Error::Storage)?;
    transfers.retain(|_, transfer| transfer.touched.elapsed() < TRANSFER_LIFETIME);
    if transfers.len() >= MAX_TRANSFERS {
        return Err(Error::Storage);
    }
    let token = uuid::Uuid::new_v4().to_string();
    transfers.insert(
        token.clone(),
        Transfer {
            directory,
            kind,
            touched: Instant::now(),
        },
    );
    Ok(token)
}

fn begin(files: &[FileInfo]) -> Result<Value> {
    if files.is_empty() || files.len() > manifest::MAX_EXTENSION_FILES {
        return Err(Error::Invalid);
    }
    let mut paths = HashSet::new();
    let mut size = 0_u64;
    for file in files {
        package::relative(&file.path)?;
        size = size.checked_add(file.size).ok_or(Error::Invalid)?;
        if size > manifest::MAX_EXTENSION_BYTES || !paths.insert(file.path.to_lowercase()) {
            return Err(Error::Invalid);
        }
    }
    let directory = tempfile::tempdir().map_err(|_| Error::Storage)?;
    let files = files
        .iter()
        .cloned()
        .map(|info| File { info, written: 0 })
        .collect();
    let token = insert(directory, Kind::Upload(files))?;
    Ok(json!({"transfer": {"token": token}}))
}

fn write(token: &str, path: &str, offset: u64, data: &str) -> Result<Value> {
    if data.len() > CHUNK_BYTES * 4 / 3 + 4 {
        return Err(Error::Invalid);
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| Error::Invalid)?;
    let mut transfers = TRANSFERS.lock().map_err(|_| Error::Storage)?;
    let transfer = transfers.get_mut(token).ok_or(Error::Missing)?;
    let Kind::Upload(files) = &mut transfer.kind else {
        return Err(Error::Invalid);
    };
    let file = files
        .iter_mut()
        .find(|file| file.info.path == path)
        .ok_or(Error::Invalid)?;
    let end = offset
        .checked_add(bytes.len() as u64)
        .ok_or(Error::Invalid)?;
    if offset != file.written || end > file.info.size {
        return Err(Error::Invalid);
    }
    let target = transfer.directory.path().join(package::relative(path)?);
    fs::create_dir_all(target.parent().ok_or(Error::Invalid)?).map_err(|_| Error::Storage)?;
    let mut output = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(target)
        .map_err(|_| Error::Storage)?;
    output.write_all(&bytes).map_err(|_| Error::Storage)?;
    file.written = end;
    transfer.touched = Instant::now();
    Ok(json!({}))
}

pub(super) fn finish(token: &str) -> Result<tempfile::TempDir> {
    let mut transfers = TRANSFERS.lock().map_err(|_| Error::Storage)?;
    let transfer = transfers.get(token).ok_or(Error::Missing)?;
    let Kind::Upload(files) = &transfer.kind else {
        return Err(Error::Invalid);
    };
    if files.iter().any(|file| file.written != file.info.size) {
        return Err(Error::Invalid);
    }
    for file in files.iter().filter(|file| file.info.size == 0) {
        let path = transfer
            .directory
            .path()
            .join(package::relative(&file.info.path)?);
        fs::create_dir_all(path.parent().ok_or(Error::Invalid)?).map_err(|_| Error::Storage)?;
        fs::File::create(path).map_err(|_| Error::Storage)?;
    }
    Ok(transfers.remove(token).ok_or(Error::Missing)?.directory)
}

pub(super) fn uploaded_source(directory: &Path) -> Result<std::path::PathBuf> {
    let files = fs::read_dir(directory)
        .map_err(|_| Error::Storage)?
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|_| Error::Storage)?;
    if files.len() == 1
        && files[0].path().is_file()
        && files[0]
            .path()
            .extension()
            .and_then(|suffix| suffix.to_str())
            .is_some_and(|suffix| {
                suffix.eq_ignore_ascii_case("zip") || suffix.eq_ignore_ascii_case("crx")
            })
    {
        return Ok(files[0].path());
    }
    Ok(directory.to_owned())
}

fn export(path: &str) -> Result<Value> {
    let directory = tempfile::tempdir().map_err(|_| Error::Storage)?;
    let size = package::export(Path::new(path), &directory.path().join("extension.zip"))?;
    let token = insert(directory, Kind::Export(size))?;
    Ok(json!({"transfer": {"token": token, "size": size}}))
}

fn read(token: &str, offset: u64) -> Result<Value> {
    let mut transfers = TRANSFERS.lock().map_err(|_| Error::Storage)?;
    let transfer = transfers.get_mut(token).ok_or(Error::Missing)?;
    let Kind::Export(size) = transfer.kind else {
        return Err(Error::Invalid);
    };
    if offset > size {
        return Err(Error::Invalid);
    }
    let mut file = fs::File::open(transfer.directory.path().join("extension.zip"))
        .map_err(|_| Error::Storage)?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|_| Error::Storage)?;
    let mut data = vec![0; (size - offset).min(CHUNK_BYTES as u64) as usize];
    file.read_exact(&mut data).map_err(|_| Error::Storage)?;
    transfer.touched = Instant::now();
    Ok(
        json!({"transfer": {"token": token, "data": base64::engine::general_purpose::STANDARD.encode(data)}}),
    )
}

fn release(token: &str) -> Result<Value> {
    TRANSFERS.lock().map_err(|_| Error::Storage)?.remove(token);
    Ok(json!({}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upload_rejects_duplicate_paths_bad_offsets_and_incomplete_files() {
        let files = vec![FileInfo {
            path: "content.js".into(),
            size: 3,
        }];
        assert!(begin(&[files[0].clone(), files[0].clone()]).is_err());
        let token = begin(&files).unwrap()["transfer"]["token"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(write(&token, "../escape", 0, "YWJj").is_err());
        assert!(write(&token, "content.js", 1, "YWJj").is_err());
        assert!(finish(&token).is_err());
        write(&token, "content.js", 0, "YWJj").unwrap();
        assert!(write(&token, "content.js", 0, "YWJj").is_err());
        let directory = finish(&token).unwrap();
        assert_eq!(
            fs::read(directory.path().join("content.js")).unwrap(),
            b"abc"
        );
        assert!(finish(&token).is_err());
    }
}
