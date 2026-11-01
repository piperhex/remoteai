//! Read-only annotations for a validated, revision-matched text snapshot.
#[cfg(test)]
use super::revision;
use super::{resolve, GuiError, GuiResponse, Target};
use crate::codex_gui::git;
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::Stdio,
};

mod porcelain;
use porcelain::{Annotations, BlameError};

#[derive(Debug, Deserialize)]
pub(crate) struct Request {
    #[serde(flatten)]
    target: Target,
    revision: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
enum Status {
    Ready,
    NotRepository,
    Untracked,
    Changed,
    Unavailable,
}

#[derive(Debug, Serialize)]
struct Response {
    status: Status,
    revision: String,
    #[serde(flatten)]
    annotations: Annotations,
}

impl Response {
    fn empty(status: Status, revision: String) -> Self {
        Self {
            status,
            revision,
            annotations: Annotations::default(),
        }
    }
}

pub(in crate::codex_gui) async fn read(request: Request) -> super::Result<GuiResponse> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = snapshot(request)?;
        Ok(GuiResponse {
            data: serde_json::to_value(result).map_err(|_| GuiError::InvalidRequest)?,
        })
    })
    .await
    .map_err(|_| GuiError::FileRead)?
}

fn snapshot(request: Request) -> super::Result<Response> {
    let path = resolve(&request.target)?;
    let document = {
        let _guard = super::locks::acquire(&path, false)?;
        if resolve(&request.target)? != path {
            return Err(GuiError::ProjectFileConflict);
        }
        super::snapshot(&path)?
    };
    if document.kind != "text" {
        return Err(GuiError::TextPreview);
    }
    let version = document.revision;
    let Some(text) = document.text else {
        return Ok(Response::empty(Status::Unavailable, version));
    };
    let bytes = text.as_bytes();
    if version != request.revision {
        return Ok(Response::empty(Status::Changed, version));
    }
    if bytes.contains(&0) || std::str::from_utf8(bytes).is_err() {
        return Err(GuiError::TextPreview);
    }
    // Use the file's parent to discover nested repositories, submodules and linked worktrees.
    let parent = path.parent().ok_or(GuiError::ProjectFiles)?;
    let status = repository_status(parent, &path);
    if status != Status::Ready {
        return Ok(Response::empty(status, version));
    }
    match annotate(parent, &path, bytes) {
        Ok(annotations) => Ok(Response {
            status: Status::Ready,
            revision: version,
            annotations,
        }),
        Err(_) => Ok(Response::empty(Status::Unavailable, version)),
    }
}

fn repository_status(parent: &Path, path: &Path) -> Status {
    let mut command = git::command(parent);
    let result = command
        .args(["rev-parse", "--is-inside-work-tree"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    let Ok(result) = result else {
        return Status::Unavailable;
    };
    if !result.status.success() || result.stdout != b"true\n" {
        return Status::NotRepository;
    }
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return Status::Unavailable;
    };
    match git::command(parent)
        .args(["cat-file", "-e", &format!("HEAD:./{name}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
    {
        Ok(status) if status.success() => Status::Ready,
        Ok(_) => Status::Untracked,
        Err(_) => Status::Unavailable,
    }
}

fn annotate(parent: &Path, path: &Path, bytes: &[u8]) -> Result<Annotations, BlameError> {
    let mut contents = tempfile::NamedTempFile::new()?;
    contents.write_all(bytes)?;
    contents.flush()?;
    let mut child = git::command(parent)
        .args([
            "blame",
            "--incremental",
            "--encoding=UTF-8",
            "--no-textconv",
            "--contents",
        ])
        .arg(contents.path())
        .arg("--")
        .arg(path.file_name().ok_or(BlameError::Invalid)?)
        .env("GIT_LITERAL_PATHSPECS", "1")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()?;
    let parsed = match child.stdout.take() {
        Some(stdout) => porcelain::parse(BufReader::new(stdout).lines()),
        None => Err(BlameError::Invalid),
    };
    if parsed.is_err() {
        // Parsing failures must not leave Git blocked on an unread pipe.
        if let Err(error) = child.kill() {
            eprintln!("Git blame cleanup: {error}");
        }
    }
    if !child.wait()?.success() {
        return Err(BlameError::Git);
    }
    parsed
}

#[cfg(test)]
mod tests;
