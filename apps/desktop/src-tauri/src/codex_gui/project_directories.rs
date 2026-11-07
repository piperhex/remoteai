//! Bounded workspace browsing; file details are opt-in for the desktop project picker.
use super::{
    error::{GuiError, Result},
    platform::{directory_roots, execution_path},
    protocol::GuiResponse,
};
use serde::Serialize;
use std::time::Duration;
use std::{fs, path::Path};
use tokio::{sync::Semaphore, time::timeout};

const MAX_ENTRIES: usize = 500;
const MAX_SCANNED_ENTRIES: usize = 10_000;
const MAX_PATH_BYTES: usize = 4096;
const BROWSE_TIMEOUT: Duration = Duration::from_secs(10);
// Timed-out filesystem calls cannot be cancelled; keep their workers bounded until the OS returns.
static BROWSE_WORKERS: Semaphore = Semaphore::const_new(4);

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    directory: bool,
    modified: Option<u64>,
    size: Option<u64>,
}

#[derive(Serialize)]
struct DirectoryListing {
    directory: String,
    parent: Option<String>,
    entries: Vec<Entry>,
    truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    shortcuts: Option<DirectoryShortcuts>,
}

#[derive(Serialize)]
struct DirectoryShortcuts {
    home: Option<String>,
    desktop: Option<String>,
    downloads: Option<String>,
    documents: Option<String>,
}

fn directory_shortcuts() -> DirectoryShortcuts {
    // OS known folders preserve redirected Windows folders and Linux XDG preferences.
    let [home, desktop, downloads, documents] = super::platform::directory_shortcuts();
    DirectoryShortcuts {
        home: home.as_deref().map(execution_path),
        desktop: desktop.as_deref().map(execution_path),
        downloads: downloads.as_deref().map(execution_path),
        documents: documents.as_deref().map(execution_path),
    }
}

pub(super) async fn list(directory: String, include_files: bool) -> Result<GuiResponse> {
    let listing = timeout(BROWSE_TIMEOUT, async move {
        let permit = BROWSE_WORKERS
            .acquire()
            .await
            .map_err(|_| GuiError::ProjectDirectories)?;
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            browse_entries(&directory, include_files)
        })
        .await
        .map_err(|_| GuiError::ProjectDirectories)?
    })
    .await
    .map_err(|_| GuiError::ProjectDirectories)??;
    let data = serde_json::to_value(listing).map_err(|_| GuiError::ProjectDirectories)?;
    Ok(GuiResponse { data })
}

fn browse_entries(directory: &str, include_files: bool) -> Result<DirectoryListing> {
    if directory.is_empty() {
        return Ok(DirectoryListing {
            directory: String::new(),
            parent: None,
            entries: directory_roots()
                .iter()
                .map(|path| Entry {
                    name: execution_path(path),
                    path: execution_path(path),
                    directory: true,
                    modified: None,
                    size: None,
                })
                .collect(),
            truncated: false,
            shortcuts: Some(directory_shortcuts()),
        });
    }
    if directory.len() > MAX_PATH_BYTES || directory.chars().any(char::is_control) {
        return Err(GuiError::ProjectDirectories);
    }
    let directory =
        super::protocol::directory(directory).map_err(|_| GuiError::ProjectDirectories)?;
    let (entries, truncated) = children(&directory, include_files)?;
    Ok(DirectoryListing {
        directory: execution_path(&directory),
        parent: Some(directory.parent().map(execution_path).unwrap_or_default()),
        entries,
        truncated,
        shortcuts: None,
    })
}

fn children(directory: &Path, include_files: bool) -> Result<(Vec<Entry>, bool)> {
    let mut entries = Vec::new();
    let mut truncated = false;
    for (index, child) in fs::read_dir(directory)
        .map_err(|_| GuiError::ProjectDirectories)?
        .enumerate()
    {
        if entries.len() >= MAX_ENTRIES || index >= MAX_SCANNED_ENTRIES {
            truncated = true;
            break;
        }
        // Unreadable or disappearing children must not prevent browsing their accessible siblings.
        let Ok(child) = child else { continue };
        let Ok(kind) = child.file_type() else {
            continue;
        };
        if !kind.is_symlink() && (kind.is_dir() || (include_files && kind.is_file())) {
            entries.push(entry(&child.path(), kind.is_dir()));
        }
    }
    entries.sort_by_key(|entry| (!entry.directory, entry.name.to_lowercase()));
    Ok((entries, truncated))
}

fn entry(path: &Path, directory: bool) -> Entry {
    let path_string = execution_path(path);
    let metadata = path.metadata().ok();
    Entry {
        name: path.file_name().map_or_else(
            || path_string.clone(),
            |name| name.to_string_lossy().into_owned(),
        ),
        path: path_string,
        directory,
        modified: metadata
            .as_ref()
            .and_then(|value| value.modified().ok())
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_secs()),
        size: if directory {
            None
        } else {
            metadata.map(|value| value.len())
        },
    }
}

#[cfg(test)]
#[path = "project_directories_tests.rs"]
mod tests;
