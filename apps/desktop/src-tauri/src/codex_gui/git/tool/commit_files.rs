//! Lists complete commit changes against the first parent, including root commits and renames.
use super::super::run;
use super::{validate_path, GitError, Result};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitFile {
    pub(super) path: String,
    pub(super) original_path: Option<String>,
    status: String,
}

pub(super) fn validate_commit(hash: &str) -> Result<()> {
    if !matches!(hash.len(), 40 | 64) || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(GitError::File);
    }
    Ok(())
}

pub(super) fn read(root: &Path, hash: &str) -> Result<Vec<CommitFile>> {
    validate_commit(hash)?;
    let result = run(
        root,
        &[
            "show",
            "--format=",
            "--name-status",
            "-z",
            "--first-parent",
            "--root",
            "--find-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            hash,
            "--",
        ],
    )?;
    if !result.status.success() {
        return Err(GitError::Operation);
    }
    parse(&result.stdout)
}

pub(super) fn parse(bytes: &[u8]) -> Result<Vec<CommitFile>> {
    let text = std::str::from_utf8(bytes).map_err(|_| GitError::File)?;
    let mut fields = text.split_terminator('\0');
    let mut files = Vec::new();
    while let Some(status) = fields.next() {
        let kind = status.chars().next().ok_or(GitError::File)?;
        let first = fields.next().ok_or(GitError::File)?;
        let (path, original) = match kind {
            'R' | 'C' => (fields.next().ok_or(GitError::File)?, Some(first)),
            'A' | 'D' | 'M' | 'T' => (first, None),
            _ => return Err(GitError::File),
        };
        validate_path(path)?;
        if let Some(original) = original {
            validate_path(original)?;
        }
        files.push(CommitFile {
            path: path.to_owned(),
            original_path: original.map(str::to_owned),
            status: kind.to_string(),
        });
    }
    Ok(files)
}
