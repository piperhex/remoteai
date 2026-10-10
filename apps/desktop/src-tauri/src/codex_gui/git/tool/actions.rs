//! Remote actions use argument arrays, retain hooks, and never stash, force-push or discard files.
use super::super::{command_options, output, validate_branch};
use super::{branches, changes, commit, GitError, Result};
use serde::Deserialize;
use std::{path::Path, process::Stdio};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Action {
    Switch,
    Fetch,
    Pull,
    Update,
    Push,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Strategy {
    #[default]
    Merge,
    Rebase,
}

#[derive(Deserialize)]
pub(crate) struct ActionRequest {
    action: Action,
    head: Option<String>,
    branch: Option<String>,
    target: Option<String>,
    #[serde(default)]
    strategy: Strategy,
}

fn run(root: &Path, args: &[&str]) -> Result<bool> {
    command_options(root, false)
        .args([
            "-c",
            "credential.interactive=false",
            "-c",
            "merge.autoStash=false",
            "-c",
            "rebase.autoStash=false",
            "-c",
            "core.editor=false",
        ])
        .env("GIT_MERGE_AUTOEDIT", "no")
        .env("GIT_SEQUENCE_EDITOR", "false")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .map_err(|_| GitError::Unavailable)
}

fn switch(root: &Path, target: &str) -> Result<()> {
    let repository = branches::read(root)?;
    let branch = repository
        .branches
        .iter()
        .find(|branch| branch.r#ref == target && !branch.occupied)
        .ok_or(GitError::Checkout)?;
    let success = if branch.remote {
        let remote = repository
            .remotes
            .iter()
            .filter(|remote| branch.name.starts_with(&format!("{remote}/")))
            .max_by_key(|remote| remote.len())
            .ok_or(GitError::Branch)?;
        let local = &branch.name[remote.len() + 1..];
        validate_branch(root, local)?;
        run(root, &["switch", "--track", "-c", local, &branch.r#ref])?
    } else {
        validate_branch(root, &branch.name)?;
        run(root, &["switch", "--no-guess", &branch.name])?
    };
    if success {
        Ok(())
    } else {
        Err(GitError::Checkout)
    }
}

fn fetch(root: &Path, remote: Option<&str>) -> Result<()> {
    if output(root, &["remote"])?.is_empty() {
        return Err(GitError::Remote);
    }
    let mut args = vec!["fetch", "--no-recurse-submodules"];
    match remote {
        Some(remote) => args.extend(["--", remote]),
        None => args.push("--all"),
    }
    if run(root, &args)? {
        Ok(())
    } else {
        Err(GitError::Network)
    }
}

fn integrate(root: &Path, request: &ActionRequest) -> Result<()> {
    if !changes::read(root)?.files.is_empty() {
        return Err(GitError::Dirty);
    }
    let upstream = branches::upstream(root)?;
    fetch(
        root,
        if matches!(request.action, Action::Update) {
            None
        } else {
            Some(&upstream.remote)
        },
    )?;
    // Fetch may take time. Recheck local state before changing files after an external Git operation.
    check_current(root, request)?;
    commit::require_idle(root)?;
    if !changes::read(root)?.files.is_empty() {
        return Err(GitError::Dirty);
    }
    let target = output(root, &["rev-parse", "--verify", &upstream.tracking])
        .map_err(|_| GitError::Upstream)?;
    let success = match (&request.action, &request.strategy) {
        (Action::Update, _) => update_merge(root, &upstream.tracking, &target)?,
        (_, Strategy::Merge) => run(root, &["merge", "--no-edit", "--no-autostash", &target])?,
        (_, Strategy::Rebase) => run(root, &["rebase", "--no-autostash", &target])?,
    };
    if success {
        Ok(())
    } else {
        Err(GitError::Integrate)
    }
}

fn update_merge(root: &Path, tracking: &str, target: &str) -> Result<bool> {
    let branch = tracking
        .strip_prefix("refs/remotes/")
        .ok_or(GitError::Upstream)?;
    // Keep the fetched commit pinned, but use the branch message accepted by commit-message hooks.
    let message = format!("Merge remote-tracking branch '{branch}'");
    run(
        root,
        &[
            "merge",
            "--ff",
            "--commit",
            "--no-squash",
            "--no-edit",
            "--no-autostash",
            "-m",
            &message,
            target,
        ],
    )
}

fn check_current(root: &Path, request: &ActionRequest) -> Result<()> {
    let branch = output(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok();
    if branch != request.branch || changes::head(root) != request.head {
        return Err(GitError::Changed);
    }
    Ok(())
}

pub(super) fn execute(root: &Path, request: &ActionRequest) -> Result<()> {
    check_current(root, request)?;
    if !matches!(request.action, Action::Fetch) {
        commit::require_idle(root)?;
    }
    match request.action {
        Action::Switch => switch(root, request.target.as_deref().ok_or(GitError::Branch)?),
        Action::Pull | Action::Update => integrate(root, request),
        Action::Push => push(root, request.head.as_deref()),
        Action::Fetch => fetch(root, None),
    }
}

fn push(root: &Path, head: Option<&str>) -> Result<()> {
    let upstream = branches::upstream(root)?;
    let mirror = format!("remote.{}.mirror=false", upstream.remote);
    let refspec = format!("{}:{}", head.ok_or(GitError::Upstream)?, upstream.source);
    if run(
        root,
        &[
            "-c",
            &mirror,
            "push",
            "--no-force",
            "--no-follow-tags",
            "--recurse-submodules=no",
            "--",
            &upstream.remote,
            &refspec,
        ],
    )? {
        Ok(())
    } else {
        Err(GitError::Push)
    }
}
