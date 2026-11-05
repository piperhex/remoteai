use super::super::{output, validate_branch};
use super::{GitError, Result};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Repository {
    pub branches: Vec<Branch>,
    pub remotes: Vec<String>,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repositories: Option<Vec<super::repositories::Entry>>,
}

#[derive(Serialize)]
pub(crate) struct Branch {
    pub name: String,
    pub r#ref: String,
    pub remote: bool,
    pub occupied: bool,
}

pub(super) struct Upstream {
    pub remote: String,
    pub source: String,
    pub tracking: String,
}

fn parse_branch(line: &str, current: Option<&str>) -> Option<Branch> {
    let parts: Vec<_> = line.split('\t').collect();
    if parts.len() != 4 || !parts[2].is_empty() {
        return None;
    }
    let remote = parts[0].starts_with("refs/remotes/");
    let prefix = if remote {
        "refs/remotes/"
    } else {
        "refs/heads/"
    };
    Some(Branch {
        name: parts[0].strip_prefix(prefix)?.to_owned(),
        r#ref: parts[0].to_owned(),
        remote,
        occupied: !parts[1].is_empty() && current != Some(parts[0]),
    })
}

pub(super) fn upstream(root: &Path) -> Result<Upstream> {
    let branch =
        output(root, &["symbolic-ref", "--quiet", "HEAD"]).map_err(|_| GitError::Upstream)?;
    let text = output(
        root,
        &[
            "for-each-ref",
            "--format=%(upstream:remotename)%09%(upstream:remoteref)%09%(upstream)",
            &branch,
        ],
    )?;
    let parts: Vec<_> = text.split('\t').collect();
    if parts.len() != 3
        || parts[0].is_empty()
        || !parts[1].starts_with("refs/heads/")
        || !parts[2].starts_with("refs/remotes/")
    {
        return Err(GitError::Upstream);
    }
    let remotes = output(root, &["remote"])?;
    if !remotes.lines().any(|remote| remote == parts[0]) || parts[0].starts_with('-') {
        return Err(GitError::Upstream);
    }
    validate_branch(root, &parts[1]["refs/heads/".len()..])?;
    Ok(Upstream {
        remote: parts[0].to_owned(),
        source: parts[1].to_owned(),
        tracking: parts[2].to_owned(),
    })
}

pub(super) fn read(root: &Path) -> Result<Repository> {
    let current = output(root, &["symbolic-ref", "--quiet", "HEAD"]).ok();
    let refs = output(
        root,
        &[
            "for-each-ref",
            "--sort=refname",
            "--format=%(refname)%09%(worktreepath)%09%(symref)%09end",
            "refs/heads/",
            "refs/remotes/",
        ],
    )?;
    let branches = refs
        .lines()
        .filter_map(|line| parse_branch(line, current.as_deref()))
        .collect();
    let upstream = output(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).ok();
    let counts = output(
        root,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .unwrap_or_default();
    let mut counts = counts
        .split_whitespace()
        .map(|value| value.parse().unwrap_or(0));
    Ok(Repository {
        repositories: None,
        branches,
        remotes: output(root, &["remote"])?
            .lines()
            .map(str::to_owned)
            .collect(),
        upstream,
        ahead: counts.next().unwrap_or(0),
        behind: counts.next().unwrap_or(0),
    })
}
