use super::super::command;
use super::{changes, commit_files, validate_path, GitError, Result};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
};

const DIFF_BYTES: u64 = 256 * 1024;
const HISTORY_BYTES: u64 = 1024 * 1024;
const PAGE_SIZE: usize = 80;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ReviewScope {
    Staged,
    Unstaged,
}

pub(super) fn workspace_diff(root: &Path, path: &str, scope: ReviewScope) -> Result<Diff> {
    validate_path(path)?;
    let status = super::super::run(
        root,
        &[
            "--no-optional-locks",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=none",
            "--find-renames",
        ],
    )?;
    if !status.status.success() {
        return Err(GitError::Repository);
    }
    let files = changes::parse(&status.stdout)?;
    let side = match scope {
        ReviewScope::Staged => 0,
        ReviewScope::Unstaged => 1,
    };
    let file = files
        .iter()
        .find(|file| {
            file.path == path
                && file.status.as_bytes()[side] != b' '
                && (side == 1 || file.status != "??")
        })
        .ok_or(GitError::Changed)?;
    let code = file.status.as_bytes()[side];
    let mut args = vec![
        "-c",
        "core.quotePath=false",
        "--no-pager",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--find-renames",
        "--ignore-submodules=none",
    ];
    if file.status == "??" {
        if root
            .join(path)
            .symlink_metadata()
            .is_ok_and(|entry| entry.is_dir())
        {
            return Ok(Diff {
                text: String::new(),
                truncated: false,
            });
        }
        args.extend(["--no-index", "--", "/dev/null", path]);
    } else {
        if side == 0 {
            args.push("--cached");
        }
        args.extend(["--", path]);
        if matches!(code, b'R' | b'C') {
            args.extend(file.original_path.as_deref());
        }
    }
    read_diff(root, &args)
}

#[derive(Serialize)]
pub(crate) struct Diff {
    text: String,
    truncated: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct History {
    commits: Vec<Commit>,
    has_more: bool,
}
#[derive(Serialize)]
pub(super) struct Commit {
    hash: String,
    parents: Vec<String>,
    author: String,
    date: String,
    subject: String,
    refs: Vec<String>,
}

pub(super) fn bounded(root: &Path, args: &[&str], limit: u64) -> Result<(Vec<u8>, bool)> {
    let mut git = command(root);
    git.args(args).env("GIT_LITERAL_PATHSPECS", "1");
    bounded_command(git, limit, args.contains(&"--no-index"))
}

pub(super) fn bounded_command(
    mut command: Command,
    limit: u64,
    no_index: bool,
) -> Result<(Vec<u8>, bool)> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|_| GitError::Unavailable)?;
    let mut bytes = Vec::new();
    let read = child
        .stdout
        .take()
        .ok_or(GitError::Operation)?
        .take(limit + 1)
        .read_to_end(&mut bytes);
    let truncated = bytes.len() as u64 > limit;
    if truncated || read.is_err() {
        // The process can finish between reaching the limit and kill; wait still reaps it.
        if let Err(error) = child.kill() {
            eprintln!("Git output reader cleanup: {error}");
        }
    }
    let status = child.wait().map_err(|_| GitError::Operation)?;
    read.map_err(|_| GitError::Operation)?;
    let difference = no_index && status.code() == Some(1);
    if !truncated && !status.success() && !difference {
        return Err(GitError::Operation);
    }
    bytes.truncate(limit as usize);
    Ok((bytes, truncated))
}

pub(super) fn diff(root: &Path, path: &str, commit: Option<&str>) -> Result<Diff> {
    if !path.is_empty() {
        validate_path(path)?;
    }
    if let Some(hash) = commit {
        return committed_diff(root, path, hash);
    }
    let current = changes::read(root)?;
    let file = current
        .files
        .iter()
        .find(|file| file.path == path)
        .ok_or(GitError::Changed)?;
    let mut args = vec![
        "--no-pager",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
    ];
    if file.status == "??" || current.head.is_none() {
        args.extend(["--no-index", "--", "/dev/null", path]);
    } else {
        args.extend(["HEAD", "--", path]);
        if let Some(original) = &file.original_path {
            args.push(original);
        }
    }
    read_diff(root, &args)
}

fn committed_diff(root: &Path, path: &str, hash: &str) -> Result<Diff> {
    commit_files::validate_commit(hash)?;
    let mut args = vec![
        "--no-pager",
        "show",
        "--format=",
        "--first-parent",
        "--find-renames",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        hash,
        "--",
    ];
    let committed;
    if !path.is_empty() {
        committed = commit_files::read(root, hash)?;
        let file = committed
            .iter()
            .find(|file| file.path == path)
            .ok_or(GitError::File)?;
        args.push(path);
        if let Some(original) = &file.original_path {
            args.push(original);
        }
    }
    read_diff(root, &args)
}

fn read_diff(root: &Path, args: &[&str]) -> Result<Diff> {
    let (bytes, truncated) = bounded(root, args, DIFF_BYTES)?;
    Ok(Diff {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
    })
}

pub(super) fn read(root: &Path, skip: usize) -> Result<History> {
    if skip > 100_000 {
        return Err(GitError::File);
    }
    if changes::head(root).is_none() {
        return Ok(History {
            commits: Vec::new(),
            has_more: false,
        });
    }
    let skip = format!("--skip={skip}");
    let count = format!("--max-count={}", PAGE_SIZE + 1);
    let (bytes, truncated) = bounded(
        root,
        &[
            "log",
            "--all",
            "HEAD",
            "--topo-order",
            "-z",
            &skip,
            &count,
            "--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%D",
        ],
        HISTORY_BYTES,
    )?;
    if truncated {
        return Err(GitError::Operation);
    }
    Ok(parse_history(&bytes))
}

fn parse_history(bytes: &[u8]) -> History {
    let text = String::from_utf8_lossy(bytes);
    let fields: Vec<_> = text.split_terminator('\0').collect();
    let mut commits: Vec<_> = fields
        .as_chunks::<6>()
        .0
        .iter()
        .map(|row| Commit {
            hash: row[0].to_owned(),
            parents: row[1].split_whitespace().map(str::to_owned).collect(),
            author: row[2].to_owned(),
            date: row[3].to_owned(),
            subject: row[4].to_owned(),
            refs: row[5]
                .split(", ")
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .collect(),
        })
        .collect();
    let has_more = commits.len() > PAGE_SIZE;
    commits.truncate(PAGE_SIZE);
    History { commits, has_more }
}
