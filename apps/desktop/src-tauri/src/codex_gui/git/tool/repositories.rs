//! Discover indexed submodules without scanning dependencies or initializing checkouts.
use super::super::{repository, run};
use super::{validate_path, GitError, Result};
use crate::codex_gui::platform::execution_path;
use serde::Serialize;
use std::{collections::BTreeSet, path::Path};

const MAX_REPOSITORIES: usize = 256;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    pub root: String,
    pub path: String,
    pub available: bool,
}

pub(super) fn paths(root: &Path) -> Result<BTreeSet<String>> {
    let result = run(root, &["ls-files", "--stage", "-z"])?;
    if !result.status.success() {
        return Err(GitError::Repository);
    }
    let text = std::str::from_utf8(&result.stdout).map_err(|_| GitError::File)?;
    let mut paths = BTreeSet::new();
    for entry in text
        .split('\0')
        .filter(|entry| entry.starts_with("160000 "))
    {
        let (_, path) = entry.split_once('\t').ok_or(GitError::File)?;
        validate_path(path)?;
        paths.insert(path.to_owned());
    }
    Ok(paths)
}

/// A missing submodule directory must never resolve to its enclosing repository.
pub(in crate::codex_gui::git) fn contains(root: &Path, directory: &Path) -> Result<bool> {
    Ok(paths(root)?
        .iter()
        .any(|path| directory.starts_with(root.join(path))))
}

pub(super) fn initialized(root: &Path, path: &str) -> bool {
    let child = root.join(path);
    let Ok(canonical) = child.canonicalize() else {
        return false;
    };
    if !canonical.starts_with(root) || canonical == root || !child.join(".git").exists() {
        return false;
    }
    repository(&canonical).is_ok_and(|found| found == canonical)
}

pub(super) fn read(root: &Path) -> Result<Vec<Entry>> {
    let mut entries = vec![Entry {
        root: execution_path(root),
        path: String::new(),
        available: true,
    }];
    let mut pending = vec![root.to_path_buf()];
    let mut visited = BTreeSet::from([root.to_path_buf()]);
    while let Some(parent) = pending.pop() {
        for path in paths(&parent)? {
            if entries.len() >= MAX_REPOSITORIES {
                return Err(GitError::TooManyFiles);
            }
            let child = parent.join(&path);
            let available = initialized(&parent, &path);
            let relative = child.strip_prefix(root).map_err(|_| GitError::File)?;
            entries.push(Entry {
                root: execution_path(&child),
                path: relative.to_string_lossy().replace('\\', "/"),
                available,
            });
            if available {
                let canonical = child.canonicalize().map_err(|_| GitError::File)?;
                if visited.insert(canonical.clone()) {
                    pending.push(canonical);
                }
            }
        }
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}
