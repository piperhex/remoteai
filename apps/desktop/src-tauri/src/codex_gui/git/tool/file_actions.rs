//! Discard or delete explicitly selected files, retaining unrelated files and index entries.
use super::{changes, commit, validate_path, GitError, Result, SelectedFile};
use commit::IndexTransaction;
use serde::Deserialize;
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs,
    io::ErrorKind,
    path::Path,
};

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Action {
    Rollback,
    Delete,
}

fn selected_paths(
    current: &changes::Changes,
    selected: &[SelectedFile],
    action: Action,
) -> Result<Vec<String>> {
    if selected.is_empty() || selected.len() > current.files.len() {
        return Err(GitError::File);
    }
    let by_path: HashMap<_, _> = current
        .files
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect();
    let selected_paths: HashSet<_> = selected.iter().map(|file| file.path.as_str()).collect();
    let mut paths = BTreeSet::new();
    for selected in selected {
        let file = by_path
            .get(selected.path.as_str())
            .filter(|file| file.version == selected.version)
            .ok_or(GitError::Changed)?;
        paths.insert(file.path.clone());
        if action == Action::Rollback && file.status.contains('R') {
            paths.extend(file.original_path.clone());
        }
    }
    // A recreated rename source may itself be another changed file. Require explicit selection of it.
    if current
        .files
        .iter()
        .any(|file| paths.contains(&file.path) && !selected_paths.contains(file.path.as_str()))
    {
        return Err(GitError::Changed);
    }
    Ok(paths.into_iter().collect())
}

/// Resolve the real write set before admission; execution validates it again under the Git index lock.
pub(super) fn affected_paths(
    root: &Path,
    head: Option<&str>,
    action: Action,
    selected: &[SelectedFile],
) -> Result<Vec<String>> {
    let current = changes::read(root)?;
    if current.head.as_deref() != head {
        return Err(GitError::Changed);
    }
    let paths = selected_paths(&current, selected, action)?;
    for path in &paths {
        validate_file(root, path)?;
    }
    Ok(paths)
}

pub(super) fn validate_file(root: &Path, path: &str) -> Result<()> {
    validate_path(path)?;
    let target = root.join(path);
    let mut parent = target.parent();
    while let Some(directory) = parent.filter(|directory| *directory != root) {
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(GitError::File);
            }
            Ok(_)
                if !directory
                    .canonicalize()
                    .map_err(|_| GitError::File)?
                    .starts_with(root) =>
            {
                return Err(GitError::File);
            }
            Err(error) if error.kind() != ErrorKind::NotFound => return Err(GitError::File),
            _ => {}
        }
        parent = directory.parent();
    }
    match fs::symlink_metadata(target) {
        Ok(metadata) if metadata.is_dir() => Err(GitError::File),
        Err(error) if error.kind() != ErrorKind::NotFound => Err(GitError::File),
        _ => Ok(()),
    }
}

fn remove_files(root: &Path, paths: &[String]) -> Result<()> {
    for path in paths {
        // Never recurse or follow a link. The complete selection was validated before any mutation.
        match fs::remove_file(root.join(path)) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(_) => return Err(GitError::Operation),
        }
    }
    Ok(())
}

fn tracked_paths(root: &Path, head: Option<&str>, paths: &[String]) -> Result<BTreeSet<String>> {
    let Some(head) = head else {
        return Ok(BTreeSet::new());
    };
    let output = super::super::command(root)
        .env("GIT_LITERAL_PATHSPECS", "1")
        .args(["ls-tree", "-r", "-z", head])
        .output()
        .map_err(|_| GitError::Unavailable)?;
    if !output.status.success() {
        return Err(GitError::Operation);
    }
    let text = String::from_utf8(output.stdout).map_err(|_| GitError::File)?;
    let selected: BTreeSet<_> = paths.iter().map(String::as_str).collect();
    text.split('\0')
        .filter(|entry| !entry.is_empty())
        .filter(|entry| {
            entry.split_once('\t').is_none_or(|(_, path)| {
                selected.contains(path)
                    || path
                        .match_indices('/')
                        .any(|(index, _)| selected.contains(&path[..index]))
            })
        })
        .map(|entry| {
            let (metadata, path) = entry.split_once('\t').ok_or(GitError::File)?;
            if metadata.starts_with("160000 ") {
                return Err(GitError::File);
            }
            Ok(path.to_owned())
        })
        .collect()
}

fn remove_from_index(transaction: &IndexTransaction, root: &Path, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let status = transaction
        .command(root)
        .args(["update-index", "--force-remove", "-z", "--stdin"])
        .stdin(fs::File::open(transaction.pathspec(paths)?).map_err(|_| GitError::Operation)?)
        .status()
        .map_err(|_| GitError::Unavailable)?;
    if !status.success() {
        return Err(GitError::Operation);
    }
    Ok(())
}

fn rollback(
    transaction: &IndexTransaction,
    root: &Path,
    head: Option<&str>,
    paths: &[String],
) -> Result<()> {
    let tracked = tracked_paths(root, head, paths)?;
    let selected: HashSet<_> = paths.iter().collect();
    // Refuse directories/submodules even when their working-tree entry is currently absent.
    if tracked.iter().any(|path| !selected.contains(path)) {
        return Err(GitError::File);
    }
    let added: Vec<_> = paths
        .iter()
        .filter(|path| !tracked.contains(*path))
        .cloned()
        .collect();
    remove_from_index(transaction, root, &added)?;
    if !tracked.is_empty() {
        let status = transaction
            .command(root)
            .args([
                "restore",
                "--source",
                head.ok_or(GitError::Changed)?,
                "--staged",
                "--worktree",
                "--pathspec-file-nul",
                "--pathspec-from-file",
            ])
            .arg(transaction.pathspec(&tracked.into_iter().collect::<Vec<_>>())?)
            .status()
            .map_err(|_| GitError::Unavailable)?;
        if !status.success() {
            return Err(GitError::Operation);
        }
    }
    remove_files(root, &added)?;
    transaction.publish()
}

/// Validate the entire snapshot before changing any selected file; keep the index locked throughout.
pub(super) fn execute(
    root: &Path,
    head: Option<&str>,
    action: Action,
    selected: &[SelectedFile],
) -> Result<()> {
    commit::require_idle(root)?;
    let transaction = IndexTransaction::new(root)?;
    let current = changes::read(root)?;
    if current.head.as_deref() != head {
        return Err(GitError::Changed);
    }
    if current.files.iter().any(|file| file.conflict) {
        return Err(GitError::Conflict);
    }
    let paths = selected_paths(&current, selected, action)?;
    for path in &paths {
        validate_file(root, path)?;
    }
    match action {
        Action::Rollback => rollback(&transaction, root, head, &paths),
        Action::Delete => remove_files(root, &paths),
    }
}
