//! Project-scoped file editing with bounded transport packets and atomic replacement.
use super::{
    error::{GuiError, Result},
    platform::execution_path,
    protocol::GuiResponse,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

const INLINE_BYTES: usize = 256 * 1024;
const IMAGE_PREVIEW_BYTES: usize = 5 * 1024 * 1024;
pub(super) mod blame;
pub(super) mod locks;
mod stream;
mod transfer;
mod windows;

#[derive(Debug, Deserialize, Clone)]
pub(crate) struct Target {
    cwd: String,
    path: String,
    #[serde(default)]
    chunk: Option<transfer::ReadRange>,
    #[serde(default)]
    window: Option<windows::Request>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Save {
    #[serde(flatten)]
    target: Target,
    #[serde(default)]
    text: Option<String>,
    revision: String,
    #[serde(default)]
    upload: Option<transfer::UploadChunk>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    path: String,
    kind: &'static str,
    size: u64,
    text: Option<String>,
    image: Option<String>,
    revision: String,
    read_only: bool,
    chunked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    window: Option<windows::Window>,
}

pub(super) async fn read(target: Target) -> Result<GuiResponse> {
    tauri::async_runtime::spawn_blocking(move || {
        if target.window.is_some() {
            return windows::read(target);
        }
        let path = resolve(&target)?;
        let _guard = locks::acquire(&path, false)?;
        if resolve(&target)? != path {
            return Err(GuiError::ProjectFileConflict);
        }
        if let Some(range) = &target.chunk {
            return transfer::read_chunk(&path, range);
        }
        response(snapshot(&path)?)
    })
    .await
    .map_err(|_| GuiError::FileRead)?
}

pub(super) async fn write(request: Save) -> Result<GuiResponse> {
    tauri::async_runtime::spawn_blocking(move || {
        if request.target.window.is_some() {
            windows::save(request)
        } else if request.upload.is_some() {
            transfer::write(request)
        } else {
            save(request).and_then(response)
        }
    })
    .await
    .map_err(|_| GuiError::ProjectFileWrite)?
}

fn response(document: Document) -> Result<GuiResponse> {
    Ok(GuiResponse {
        data: serde_json::to_value(document).map_err(|_| GuiError::InvalidRequest)?,
    })
}

fn resolve(target: &Target) -> Result<PathBuf> {
    super::local_file::validate(&target.cwd)?;
    super::local_file::validate(&target.path)?;
    let root = Path::new(&target.cwd);
    if !root.is_absolute() || target.cwd.len() > 4096 || target.path.len() > 4096 {
        return Err(GuiError::ProjectFiles);
    }
    let root = root.canonicalize().map_err(|_| GuiError::ProjectFiles)?;
    let path = root
        .join(&target.path)
        .canonicalize()
        .map_err(|_| GuiError::FileRead)?;
    if !path.starts_with(&root) || !root.is_dir() || !path.is_file() {
        return Err(GuiError::ProjectFiles);
    }
    Ok(path)
}

#[cfg(test)]
fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn snapshot(path: &Path) -> Result<Document> {
    let metadata = fs::metadata(path).map_err(|_| GuiError::FileRead)?;
    let mut document = Document {
        path: execution_path(path),
        kind: "large",
        size: metadata.len(),
        text: None,
        image: None,
        revision: String::new(),
        read_only: true,
        chunked: false,
        window: None,
    };
    if metadata.len() > IMAGE_PREVIEW_BYTES as u64 && image_mime(path).is_some() {
        return Ok(document);
    }
    let mut file = File::open(path).map_err(|_| GuiError::FileRead)?;
    let limit = if image_mime(path).is_some() {
        IMAGE_PREVIEW_BYTES
    } else {
        INLINE_BYTES
    };
    let scan = stream::scan(&mut file, None, limit, None)?;
    stream::unchanged(path, &metadata)?;
    document.size = scan.size;
    document.revision = scan.revision;
    if let Some(mime) = image_mime(path) {
        if scan.size > IMAGE_PREVIEW_BYTES as u64 {
            return Err(GuiError::FileTooLarge);
        }
        document.kind = "image";
        document.image = Some(format!(
            "data:{mime};base64,{}",
            STANDARD.encode(&scan.inline)
        ));
    } else if scan.text && !is_pdf(path) {
        document.kind = "text";
        document.chunked = scan.size > INLINE_BYTES as u64;
        if !document.chunked {
            document.text = Some(String::from_utf8(scan.inline).map_err(|_| GuiError::FileRead)?);
        }
        document.read_only = metadata.permissions().readonly();
    } else {
        document.kind = "binary";
    }
    Ok(document)
}

fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

fn is_pdf(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

fn save(request: Save) -> Result<Document> {
    let text = request.text.as_deref().ok_or(GuiError::InvalidRequest)?;
    if text.len() > INLINE_BYTES {
        return Err(GuiError::InvalidRequest);
    }
    let path = resolve(&request.target)?;
    let _guard = locks::acquire(&path, false)?;
    let current = snapshot(&path)?;
    if current.read_only || current.kind != "text" || text.contains('\0') {
        return Err(GuiError::ProjectFileWrite);
    }
    if current.revision != request.revision {
        return Err(GuiError::ProjectFileConflict);
    }
    let parent = path.parent().ok_or(GuiError::ProjectFileWrite)?;
    let mut staged =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| GuiError::ProjectFileWrite)?;
    let permissions = fs::metadata(&path)
        .map_err(|_| GuiError::FileRead)?
        .permissions();
    staged
        .write_all(text.as_bytes())
        .and_then(|()| staged.as_file().set_permissions(permissions))
        .and_then(|()| staged.as_file().sync_all())
        .map_err(|_| GuiError::ProjectFileWrite)?;
    // Resolve and check again after staging to retain edits made by other applications while staging.
    if resolve(&request.target)? != path || stream::inspect(&path)?.revision != request.revision {
        return Err(GuiError::ProjectFileConflict);
    }
    // Prepare the saved baseline before replacement so a successful write cannot become a read error.
    let mut saved = snapshot(staged.path())?;
    saved.path = execution_path(&path);
    staged
        .persist(&path)
        .map_err(|_| GuiError::ProjectFileWrite)?;
    Ok(saved)
}

#[cfg(test)]
#[path = "project_editor_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "project_editor/transfer_tests.rs"]
mod transfer_tests;
