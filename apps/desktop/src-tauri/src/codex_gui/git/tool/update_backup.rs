//! Durable per-worktree recovery records. A backup stays reachable until restoration succeeds.
use super::super::{output, run};
use super::{actions, integration::git_path, GitError, Result};
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path};

const RECORD: &str = "remoteai-update.json";

#[derive(Clone, Copy, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Phase {
    Saving,
    Saved,
    Applying,
    Review,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Backup {
    pub id: String,
    pub stash: Option<String>,
    pub native: bool,
    #[serde(default)]
    pub(super) stash_before: Option<String>,
    pub(super) phase: Phase,
}

impl Backup {
    fn reference(&self) -> String {
        format!("refs/remoteai/update/{}", self.id)
    }

    pub(super) fn write(&self, root: &Path) -> Result<()> {
        let path = git_path(root, RECORD)?;
        let directory = path.parent().ok_or(GitError::UpdateSave)?;
        let mut file =
            tempfile::NamedTempFile::new_in(directory).map_err(|_| GitError::UpdateSave)?;
        let bytes = serde_json::to_vec(self).map_err(|_| GitError::UpdateSave)?;
        file.write_all(&bytes).map_err(|_| GitError::UpdateSave)?;
        file.as_file()
            .sync_all()
            .map_err(|_| GitError::UpdateSave)?;
        file.persist(path).map_err(|_| GitError::UpdateSave)?;
        Ok(())
    }

    /// Failure records are acknowledged without deleting their backup, even after manual resolution.
    pub(super) fn finish(&self, root: &Path, restored: bool) -> Result<()> {
        if restored {
            if let Some(stash) = &self.stash {
                if !self.native {
                    drop_owned_stash(root, stash, &self.id)?;
                }
                if !actions::run(root, &["update-ref", "-d", &self.reference(), stash])? {
                    return Err(GitError::UpdateRestore);
                }
            }
        }
        fs::remove_file(git_path(root, RECORD)?).map_err(|_| GitError::UpdateRestore)
    }
}

fn stash_entries(root: &Path) -> Result<String> {
    output(root, &["stash", "list", "--format=%H%x09%gd%x09%gs"])
}

pub(super) fn stash_head(root: &Path) -> Result<Option<String>> {
    let result = run(root, &["rev-parse", "--verify", "--quiet", "refs/stash"])?;
    match result.status.code() {
        Some(0) => String::from_utf8(result.stdout)
            .map(|value| Some(value.trim().to_owned()))
            .map_err(|_| GitError::Operation),
        Some(1) => Ok(None),
        _ => Err(GitError::Operation),
    }
}

fn find_stash(root: &Path, id: &str) -> Result<Option<String>> {
    Ok(stash_entries(root)?.lines().find_map(|line| {
        let fields: Vec<_> = line.splitn(3, '\t').collect();
        (fields.len() == 3 && fields[2].ends_with(id)).then(|| fields[0].to_owned())
    }))
}

fn drop_owned_stash(root: &Path, oid: &str, id: &str) -> Result<()> {
    for line in stash_entries(root)?.lines() {
        let fields: Vec<_> = line.splitn(3, '\t').collect();
        if fields.len() == 3 && fields[0] == oid && fields[2].ends_with(id) {
            // Never pop: restoration uses the immutable object ID; only our entry may be removed.
            if !actions::run(root, &["stash", "drop", fields[1]])? {
                return Err(GitError::UpdateRestore);
            }
            break;
        }
    }
    Ok(())
}

pub(super) fn read(root: &Path) -> Result<Option<Backup>> {
    let bytes = match fs::read(git_path(root, RECORD)?) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(GitError::UpdateSave),
    };
    let mut backup: Backup = serde_json::from_slice(&bytes).map_err(|_| GitError::UpdateSave)?;
    if uuid::Uuid::parse_str(&backup.id).is_err() {
        return Err(GitError::UpdateSave);
    }
    // A process can stop after `stash push` but before the record is updated.
    if backup.stash.is_none() {
        backup.stash = find_stash(root, &backup.id)?;
    }
    if backup.stash.as_ref().is_some_and(|oid| {
        !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit())
    }) {
        return Err(GitError::UpdateSave);
    }
    Ok(Some(backup))
}

pub(super) fn save(root: &Path, native: bool) -> Result<Backup> {
    let mut backup = Backup {
        id: uuid::Uuid::new_v4().to_string(),
        stash: None,
        native,
        stash_before: stash_head(root)?,
        phase: Phase::Saving,
    };
    backup.write(root)?;
    let stash = if native {
        // Native autostash manages the worktree. Pin a separate safety copy before Git can change it.
        output(root, &["stash", "create", &backup.id])?
    } else {
        if !actions::run(
            root,
            &["stash", "push", "--include-untracked", "-m", &backup.id],
        )? {
            return Err(GitError::UpdateSave);
        }
        find_stash(root, &backup.id)?.ok_or(GitError::UpdateSave)?
    };
    if stash.is_empty()
        || !run(root, &["update-ref", &backup.reference(), &stash])?
            .status
            .success()
    {
        return Err(GitError::UpdateSave);
    }
    backup.stash = Some(stash);
    backup.phase = Phase::Saved;
    backup.write(root)?;
    Ok(backup)
}
