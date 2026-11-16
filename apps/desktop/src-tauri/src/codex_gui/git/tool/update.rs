//! Safe Merge/Rebase updates, with explicit stashing when native autostash cannot preserve the index/untracked files.
use super::super::{command_options, run};
use super::actions::{self, Action, ActionRequest, Strategy};
use super::update_backup::{self, Phase};
use super::{changes, integration, GitError, Result};
use std::{path::Path, process::Stdio};

pub(super) fn preflight(root: &Path) -> Result<changes::Changes> {
    if update_backup::read(root)?.is_some() {
        return Err(GitError::UpdatePending);
    }
    let state = changes::read(root)?;
    if state.files.iter().any(|file| file.conflict) {
        return Err(GitError::Conflict);
    }
    // Git stash cannot save nested worktrees or changed gitlinks. Never claim to have saved them.
    if state
        .files
        .iter()
        .any(|file| file.submodule && file.reference_changed == Some(true))
    {
        return Err(GitError::UpdateSubmodule);
    }
    Ok(state)
}

fn supports_autostash(root: &Path, strategy: &Strategy) -> Result<bool> {
    let operation = match strategy {
        Strategy::Merge => "merge",
        Strategy::Rebase => "rebase",
    };
    // Capability detection is read-only; never retry a possibly executed integration with different flags.
    let help = command_options(root, false)
        .args([operation, "-h"])
        .stdin(Stdio::null())
        .output()
        .map_err(|_| GitError::Unavailable)?;
    let text =
        String::from_utf8_lossy(&help.stdout).into_owned() + &String::from_utf8_lossy(&help.stderr);
    Ok(text
        .split_whitespace()
        .any(|flag| matches!(flag, "--autostash" | "--[no-]autostash")))
}

pub(super) fn execute(
    root: &Path,
    request: &ActionRequest,
    tracking: &str,
    target: &str,
) -> Result<()> {
    let state = preflight(root)?;
    let files: Vec<_> = state.files.iter().filter(|file| !file.submodule).collect();
    let native = supports_autostash(root, &request.strategy)?;
    if !files.is_empty() {
        let unstaged_only = files.iter().all(|file| file.status.starts_with(' '));
        update_backup::save(root, native && unstaged_only)?;
    }
    let flag = if native { "--autostash" } else { "" };
    let result = match (&request.action, &request.strategy) {
        (_, Strategy::Rebase) => actions::run(root, &command_args(&["rebase", flag, target])),
        (Action::Update, _) => actions::update_merge(root, tracking, target, flag),
        _ => actions::run(root, &command_args(&["merge", "--no-edit", flag, target])),
    };
    complete(root, result)
}

fn complete(root: &Path, result: Result<bool>) -> Result<()> {
    // Conflicts during native restoration can accompany exit code 0. Inspect Git state, not output text.
    if integration::read_git(root)?.is_some() {
        return Err(GitError::Integrate);
    }
    let success = result?;
    if !success {
        if let Some(mut backup) = update_backup::read(root)?.filter(|backup| backup.native) {
            backup.phase = Phase::Review;
            backup.write(root)?;
            return Err(GitError::UpdateRestore);
        }
    }
    finish(root)?;
    if success {
        Ok(())
    } else {
        Err(GitError::Integrate)
    }
}

fn command_args<'a>(args: &[&'a str]) -> Vec<&'a str> {
    args.iter().copied().filter(|arg| !arg.is_empty()).collect()
}

pub(super) fn has_conflicts(root: &Path) -> Result<bool> {
    let result = run(root, &["ls-files", "--unmerged", "-z"])?;
    if !result.status.success() {
        return Err(GitError::Repository);
    }
    Ok(!result.stdout.is_empty())
}

/// Called after both the initial integration and a later Merge/Rebase continuation.
pub(super) fn finish(root: &Path) -> Result<()> {
    let Some(mut backup) = update_backup::read(root)? else {
        return Ok(());
    };
    // Git also retains autostashes after non-conflict failures, such as a locked index.
    // A changed stash ref is conservatively treated as incomplete restoration, never as success.
    if has_conflicts(root)?
        || (backup.native && update_backup::stash_head(root)? != backup.stash_before)
    {
        backup.phase = Phase::Review;
        backup.write(root)?;
        return Err(GitError::UpdateRestore);
    }
    if backup.phase != Phase::Saved {
        return Err(GitError::UpdateRestore);
    }
    if backup.native {
        return backup.finish(root, true);
    }
    let stash = backup.stash.clone().ok_or(GitError::UpdateRestore)?;
    // Persist before applying: after a crash, never silently apply the same changes a second time.
    backup.phase = Phase::Applying;
    backup.write(root)?;
    if !actions::run(root, &["stash", "apply", "--index", &stash])? {
        backup.phase = Phase::Review;
        backup.write(root)?;
        return Err(GitError::UpdateRestore);
    }
    backup.finish(root, true)
}

pub(super) fn resume(root: &Path) -> Result<()> {
    let backup = update_backup::read(root)?.ok_or(GitError::ConflictChanged)?;
    if has_conflicts(root)? {
        return Err(GitError::ConflictMarkers);
    }
    if backup.phase == Phase::Saved && !backup.native {
        return finish(root);
    }
    // Manual recovery / native autostash interruption: acknowledge only, retaining the durable backup.
    backup.finish(root, false)
}
