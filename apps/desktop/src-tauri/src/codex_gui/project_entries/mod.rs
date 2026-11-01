//! Project-scoped tree mutations. All filesystem work and the shared edit lock run off the UI thread.
mod archive;
mod archive_progress;
mod paths;
#[cfg(test)]
mod tests;
mod tree;

use super::{error::GuiError, platform::execution_path, protocol::GuiResponse};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

pub(super) use archive::create as archive;
pub(super) use archive::create_with_progress as archive_with_progress;
pub(super) use archive_progress::ArchiveProgress;

#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("请选择当前项目中的文件或文件夹。")]
    Path,
    #[error("名称无效，请勿使用路径分隔符或特殊字符。")]
    Name,
    #[error("已有同名文件或文件夹，请换一个名称。")]
    Exists,
    #[error("不能移动或删除项目根目录。")]
    Root,
    #[error("不能将文件夹放入自身或它的子文件夹。")]
    Descendant,
    #[error("所选内容包含链接或特殊文件，暂不支持此操作。")]
    Link,
    #[error("文件数量过多，请选择较小的文件夹。")]
    TooMany,
    #[error("文件夹超过当前下载大小上限。")]
    TooLarge,
    #[error("下载已暂停。")]
    Cancelled,
    #[error("操作未完成，请确认文件仍存在且有访问权限。")]
    Operation,
}
type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Action {
    CreateFile { name: String },
    CreateFolder { name: String },
    Rename { name: String },
    Copy { directory: String },
    Move { directory: String },
    Delete,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Request {
    cwd: String,
    path: String,
    #[serde(flatten)]
    action: Action,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Change {
    path: String,
    directory: bool,
}

pub(super) async fn execute(request: Request) -> super::error::Result<GuiResponse> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = paths::root(&request.cwd).map_err(GuiError::ProjectEntry)?;
        let _guard = super::project_editor::locks::acquire(&root, true)?;
        if paths::root(&request.cwd).map_err(GuiError::ProjectEntry)? != root {
            return Err(GuiError::ProjectFiles);
        }
        let change = perform(request).map_err(GuiError::ProjectEntry)?;
        Ok(GuiResponse {
            data: serde_json::to_value(change).map_err(|_| GuiError::InvalidRequest)?,
        })
    })
    .await
    .map_err(|_| GuiError::ProjectEntry(Error::Operation))?
}

fn move_entry(source: &Path, destination: &Path) -> Result<()> {
    if source == destination {
        return Ok(());
    }
    if destination.starts_with(source) {
        return Err(Error::Descendant);
    }
    paths::require_missing(destination)?;
    fs::rename(source, destination).map_err(|_| Error::Operation)
}

fn transfer(root: &Path, source: &Path, directory: &str, copy: bool) -> Result<std::path::PathBuf> {
    let parent = paths::resolve(root, directory)?;
    if parent.starts_with(source) {
        return Err(Error::Descendant);
    }
    if copy {
        let path = paths::copy_destination(source, &parent)?;
        tree::copy(source, &path)?;
        return Ok(path);
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(Error::Name)?;
    let path = paths::child(&parent, name)?;
    move_entry(source, &path)?;
    Ok(path)
}

fn perform(request: Request) -> Result<Change> {
    let root = paths::root(&request.cwd)?;
    let source = paths::resolve(&root, &request.path)?;
    let directory = source.is_dir();
    if source == root
        && matches!(
            request.action,
            Action::Rename { .. } | Action::Move { .. } | Action::Delete
        )
    {
        return Err(Error::Root);
    }
    let path = apply(&root, &source, request.action)?;
    Ok(Change {
        directory: if path.exists() {
            path.is_dir()
        } else {
            directory
        },
        path: execution_path(&path),
    })
}

fn apply(root: &Path, source: &Path, action: Action) -> Result<std::path::PathBuf> {
    match action {
        Action::CreateFile { name } => {
            let path = paths::child(source, &name)?;
            paths::require_missing(&path)?;
            fs::File::create_new(&path).map_err(|_| Error::Operation)?;
            Ok(path)
        }
        Action::CreateFolder { name } => {
            let path = paths::child(source, &name)?;
            paths::require_missing(&path)?;
            fs::create_dir(&path).map_err(|_| Error::Operation)?;
            Ok(path)
        }
        Action::Rename { name } => {
            let path = paths::child(source.parent().ok_or(Error::Path)?, &name)?;
            move_entry(source, &path)?;
            Ok(path)
        }
        Action::Copy { directory } => transfer(root, source, &directory, true),
        Action::Move { directory } => transfer(root, source, &directory, false),
        Action::Delete => {
            tree::scan(source)?;
            if source.is_dir() {
                fs::remove_dir_all(source)
            } else {
                fs::remove_file(source)
            }
            .map_err(|_| Error::Operation)?;
            Ok(source.to_owned())
        }
    }
}
