//! Describe and resume interrupted integrations, including after the last conflict is staged.
use super::super::{command_options, output, run};
use super::{changes, GitError, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::Path, process::Stdio};

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Kind {
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Stash,
}

#[derive(Serialize)]
pub(crate) struct Integration {
    pub kind: Kind,
    pub version: String,
}

pub(super) fn git_path(root: &Path, name: &str) -> Result<std::path::PathBuf> {
    output(
        root,
        &["rev-parse", "--path-format=absolute", "--git-path", name],
    )
    .map(Into::into)
}

/// Include index bytes and operation identity, so another Git process cannot silently replace our snapshot.
pub(super) fn fingerprint(root: &Path) -> Result<Sha256> {
    let mut hash = Sha256::new();
    hash.update(changes::head(root).unwrap_or_default());
    let directory = git_path(root, "index")?
        .parent()
        .ok_or(GitError::Directory)?
        .to_path_buf();
    for name in [
        "index",
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "REBASE_HEAD",
        "rebase-merge/head-name",
        "rebase-merge/onto",
        "rebase-merge/done",
        "rebase-apply/head-name",
        "rebase-apply/onto",
        "rebase-apply/next",
        "sequencer/todo",
        "remoteai-update.json",
    ] {
        hash.update(name);
        match fs::read(directory.join(name)) {
            Ok(bytes) => hash.update(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(GitError::Operation),
        }
    }
    Ok(hash)
}

pub(super) fn read(root: &Path) -> Result<Option<Integration>> {
    if let Some(state) = read_git(root)? {
        return Ok(Some(state));
    }
    if super::update_backup::read(root)?.is_some() {
        return Ok(Some(Integration {
            kind: Kind::Stash,
            version: format!("{:x}", fingerprint(root)?.finalize()),
        }));
    }
    Ok(None)
}

pub(super) fn read_git(root: &Path) -> Result<Option<Integration>> {
    let directory = git_path(root, "MERGE_HEAD")?
        .parent()
        .ok_or(GitError::Directory)?
        .to_path_buf();
    for (name, kind) in [
        ("rebase-merge", Kind::Rebase),
        ("rebase-apply", Kind::Rebase),
        ("MERGE_HEAD", Kind::Merge),
        ("CHERRY_PICK_HEAD", Kind::CherryPick),
        ("REVERT_HEAD", Kind::Revert),
    ] {
        if directory.join(name).exists() {
            return Ok(Some(Integration {
                kind,
                version: format!("{:x}", fingerprint(root)?.finalize()),
            }));
        }
    }
    Ok(None)
}

pub(super) fn resume(root: &Path, version: &str) -> Result<()> {
    let state = read(root)?.ok_or(GitError::ConflictChanged)?;
    if state.version != version {
        return Err(GitError::ConflictChanged);
    }
    let unmerged = run(root, &["ls-files", "--unmerged", "-z"])?;
    if !unmerged.status.success() || !unmerged.stdout.is_empty() {
        return Err(GitError::ConflictMarkers);
    }
    let args = match state.kind {
        Kind::Merge => ["commit", "--no-edit"],
        Kind::Rebase => ["rebase", "--continue"],
        Kind::CherryPick => ["cherry-pick", "--continue"],
        Kind::Revert => ["revert", "--continue"],
        Kind::Stash => return super::update::resume(root),
    };
    let status = command_options(root, false)
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| GitError::Unavailable)?;
    if !status.success() {
        return Err(GitError::ContinueFailed);
    }
    if read_git(root)?.is_none() {
        super::update::finish(root)?;
    }
    Ok(())
}
