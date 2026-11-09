use super::{GitError, Result};
use crate::codex_gui::git::{output, run};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};

const MAX_UNTRACKED_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct Revision {
    pub id: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub dirty: bool,
}

pub(super) fn read(root: &Path) -> Result<Revision> {
    validate_index(root)?;
    let head = super::super::changes::head(root);
    let mut hash = Sha256::new();
    hash.update(head.as_deref().unwrap_or("unborn"));
    let status = bytes(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    let index = bytes(root, &["ls-files", "--stage", "-z"])?;
    // Submodule content cannot be represented by the parent gitlink alone.
    if index
        .split(|byte| *byte == 0)
        .any(|entry| entry.starts_with(b"160000 "))
    {
        return Err(GitError::ReviewSubmodule);
    }
    hash.update(&status);
    hash.update(index);
    hash.update(bytes(
        root,
        &["diff", "--binary", "--no-ext-diff", "--no-textconv"],
    )?);
    hash_untracked(root, &mut hash)?;
    let branch = output(root, &["symbolic-ref", "--short", "HEAD"]).ok();
    hash.update(branch.as_deref().unwrap_or("detached"));
    Ok(Revision {
        id: format!("{:x}", hash.finalize()),
        head,
        branch,
        dirty: !status.is_empty(),
    })
}

fn validate_index(root: &Path) -> Result<()> {
    // Git diff omits assume-unchanged and skip-worktree paths; never certify an incomplete snapshot.
    let entries = bytes(root, &["ls-files", "-v", "-z"])?;
    if entries.split(|byte| *byte == 0).any(|entry| {
        entry
            .first()
            .is_some_and(|flag| *flag == b'S' || flag.is_ascii_lowercase())
    }) {
        return Err(GitError::ReviewHiddenFiles);
    }
    Ok(())
}

fn bytes(root: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let result = run(root, args)?;
    if !result.status.success() {
        return Err(GitError::Operation);
    }
    Ok(result.stdout)
}

fn hash_untracked(root: &Path, hash: &mut Sha256) -> Result<()> {
    let list = bytes(root, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    let text = std::str::from_utf8(&list).map_err(|_| GitError::File)?;
    let mut remaining = MAX_UNTRACKED_BYTES;
    for path in text.split('\0').filter(|path| !path.is_empty()) {
        super::super::validate_path(path)?;
        let file = root.join(path);
        let meta = fs::symlink_metadata(&file).map_err(|_| GitError::File)?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > remaining {
            return Err(GitError::ReviewSize);
        }
        if !file
            .canonicalize()
            .map_err(|_| GitError::File)?
            .starts_with(root)
        {
            return Err(GitError::File);
        }
        remaining -= meta.len();
        hash.update(path.as_bytes());
        hash.update([0]);
        let mut content = Vec::new();
        fs::File::open(file)
            .map_err(|_| GitError::File)?
            .take(meta.len() + 1)
            .read_to_end(&mut content)
            .map_err(|_| GitError::File)?;
        if content.len() as u64 != meta.len() {
            return Err(GitError::ReviewChanged);
        }
        hash.update(Sha256::digest(&content));
    }
    Ok(())
}
