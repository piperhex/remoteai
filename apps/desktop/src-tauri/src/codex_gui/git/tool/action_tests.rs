use super::super::output;
use super::{actions, branches, changes, tests::Repo, GitError, Result};
use serde_json::json;

fn action(repo: &Repo, action: &str, target: Option<&str>, strategy: &str) -> Result<()> {
    let state = changes::read(&repo.0)?;
    let request = serde_json::from_value(json!({ "action": action, "head": state.head,
        "branch": state.branch, "target": target, "strategy": strategy }))
    .unwrap();
    actions::execute(&repo.0, &request)
}

fn remote_pair() -> (Repo, Repo) {
    let remote = Repo::new(true);
    // A local non-bare remote keeps these integration tests offline; pushing to an unselected branch is safe.
    remote.git(&["branch", "published"]);
    let local = Repo::new(false);
    local.git(&[
        "remote",
        "add",
        "origin",
        &crate::codex_gui::platform::execution_path(&remote.0),
    ]);
    local.git(&["fetch", "origin"]);
    local.git(&["switch", "-c", "work", "--track", "origin/published"]);
    (remote, local)
}

fn remote_commit(remote: &Repo, file: &str) {
    remote.write(file, "remote change\n");
    remote.git(&["add", file]);
    remote.git(&["commit", "-m", "remote change"]);
    remote.git(&["branch", "-f", "published", "HEAD"]);
}

#[test]
fn branch_list_switch_and_remote_tracking_preserve_local_files() {
    let (_remote, local) = remote_pair();
    local.git(&["branch", "feature"]);
    let info = branches::read(&local.0).unwrap();
    assert!(info
        .branches
        .iter()
        .any(|branch| branch.name == "feature" && !branch.remote));
    assert!(info
        .branches
        .iter()
        .any(|branch| branch.name == "origin/main" && branch.remote));
    local.write("one.txt", "local edits\n");
    action(&local, "switch", Some("refs/heads/feature"), "merge").unwrap();
    assert_eq!(
        std::fs::read_to_string(local.0.join("one.txt")).unwrap(),
        "local edits\n"
    );
    action(&local, "switch", Some("refs/remotes/origin/main"), "merge").unwrap();
    assert_eq!(
        branches::read(&local.0).unwrap().upstream.as_deref(),
        Some("origin/main")
    );
    assert!(action(&local, "switch", Some("--discard-changes"), "merge").is_err());
}

#[test]
fn fetch_keeps_dirty_files_and_update_requires_clean_state() {
    let (remote, local) = remote_pair();
    remote_commit(&remote, "remote.txt");
    let head = changes::head(&local.0);
    local.write("one.txt", "local\n");
    local.git(&["add", "one.txt"]);
    local.write("one.txt", "local unstaged\n");
    local.git(&["config", "rebase.autoStash", "true"]);
    action(&local, "fetch", None, "merge").unwrap();
    assert_eq!(branches::read(&local.0).unwrap().behind, 1);
    assert_eq!(changes::head(&local.0), head);
    assert!(matches!(
        action(&local, "pull", None, "rebase"),
        Err(GitError::Dirty)
    ));
    assert_eq!(output(&local.0, &["show", ":one.txt"]).unwrap(), "local");
    assert_eq!(
        std::fs::read_to_string(local.0.join("one.txt")).unwrap(),
        "local unstaged\n"
    );
}

#[test]
fn update_merges_divergence_and_pull_rebases_when_selected() {
    for strategy in ["merge", "rebase"] {
        let (remote, local) = remote_pair();
        remote_commit(&remote, "remote.txt");
        local.write("local.txt", "local\n");
        local.git(&["add", "local.txt"]);
        local.git(&["commit", "-m", "local change"]);
        action(
            &local,
            if strategy == "merge" {
                "update"
            } else {
                "pull"
            },
            None,
            strategy,
        )
        .unwrap();
        assert!(local.0.join("remote.txt").is_file());
        assert!(local.0.join("local.txt").is_file());
        let parents = output(&local.0, &["rev-list", "--parents", "-n", "1", "HEAD"]).unwrap();
        assert_eq!(
            parents.split_whitespace().count(),
            if strategy == "merge" { 3 } else { 2 }
        );
        assert!(changes::read(&local.0).unwrap().files.is_empty());
    }
}

#[test]
fn push_is_explicit_and_never_forces_a_divergent_remote() {
    let (remote, local) = remote_pair();
    local.write("local.txt", "local\n");
    local.git(&["add", "local.txt"]);
    local.git(&["commit", "-m", "local"]);
    action(&local, "push", None, "merge").unwrap();
    assert_eq!(
        output(&remote.0, &["rev-parse", "published"]).unwrap(),
        changes::head(&local.0).unwrap()
    );
    remote_commit(&remote, "remote.txt");
    let remote_head = output(&remote.0, &["rev-parse", "published"]).unwrap();
    local.git(&["config", "remote.origin.push", "+HEAD:published"]);
    local.git(&["config", "remote.origin.mirror", "true"]);
    assert!(matches!(
        action(&local, "push", None, "merge"),
        Err(GitError::Push)
    ));
    assert_eq!(
        output(&remote.0, &["rev-parse", "published"]).unwrap(),
        remote_head
    );
}

#[test]
fn conflicts_remain_visible_and_stale_actions_are_rejected() {
    let (remote, local) = remote_pair();
    remote_commit(&remote, "one.txt");
    local.write("one.txt", "conflicting local\n");
    local.git(&["commit", "-am", "local"]);
    let stale = serde_json::from_value(json!({ "action": "switch", "head": "outdated",
        "branch": "work", "target": "refs/heads/work" }))
    .unwrap();
    assert!(matches!(
        actions::execute(&local.0, &stale),
        Err(GitError::Changed)
    ));
    assert!(matches!(
        action(&local, "update", None, "merge"),
        Err(GitError::Integrate)
    ));
    assert!(changes::read(&local.0)
        .unwrap()
        .files
        .iter()
        .any(|file| file.conflict));
    assert!(matches!(
        action(&local, "switch", Some("refs/remotes/origin/main"), "merge"),
        Err(GitError::Conflict)
    ));
}

#[test]
fn missing_remote_or_upstream_fail_without_mutating_repository() {
    let local = Repo::new(true);
    assert!(matches!(
        action(&local, "fetch", None, "merge"),
        Err(GitError::Remote)
    ));
    assert!(matches!(
        action(&local, "pull", None, "merge"),
        Err(GitError::Upstream)
    ));
    local.git(&["remote", "add", "origin", "nonexistent-remote"]);
    assert!(matches!(
        action(&local, "fetch", None, "merge"),
        Err(GitError::Network)
    ));
    assert!(changes::read(&local.0).unwrap().files.is_empty());
}

fn commit_hook(repo: &Repo, script: &str) {
    let path = repo.0.join(".git/hooks/commit-msg");
    std::fs::write(&path, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[test]
fn update_always_merges_with_the_tracking_branch_message_and_runs_hooks() {
    let (remote, local) = remote_pair();
    remote_commit(&remote, "remote.txt");
    local.write("local.txt", "local\n");
    local.git(&["add", "local.txt"]);
    local.git(&["commit", "-m", "local"]);
    let local_head = changes::head(&local.0).unwrap();
    let remote_head = changes::head(&remote.0).unwrap();
    commit_hook(
        &local,
        "#!/bin/sh\nprintf 'checked' > .git/message-checked\n\
         test \"$(cat \"$1\")\" = \"Merge remote-tracking branch 'origin/published'\"\n",
    );
    action(&local, "update", None, "rebase").unwrap();
    assert_eq!(
        output(&local.0, &["log", "-1", "--format=%s"]).unwrap(),
        "Merge remote-tracking branch 'origin/published'"
    );
    assert_eq!(
        output(&local.0, &["log", "-1", "--format=%P"]).unwrap(),
        format!("{local_head} {remote_head}")
    );
    assert!(local.0.join(".git/message-checked").exists());
    assert!(changes::read(&local.0).unwrap().files.is_empty());
    assert!(!local.0.join(".git/MERGE_HEAD").exists());
}

#[test]
fn update_completes_merge_despite_branch_defaults_that_stop_before_committing() {
    for options in ["--no-commit", "--squash", "--ff-only"] {
        let (remote, local) = remote_pair();
        remote_commit(&remote, "remote.txt");
        local.write("local.txt", "local\n");
        local.git(&["add", "local.txt"]);
        local.git(&["commit", "-m", "local"]);
        local.git(&["config", "branch.work.mergeOptions", options]);
        action(&local, "update", None, "merge").unwrap();
        assert_eq!(
            output(&local.0, &["log", "-1", "--format=%P"])
                .unwrap()
                .split_whitespace()
                .count(),
            2
        );
        assert!(changes::read(&local.0).unwrap().files.is_empty());
        assert!(!local.0.join(".git/MERGE_HEAD").exists());
    }
}

#[test]
fn update_fast_forwards_and_repeated_updates_do_not_add_commits() {
    let (remote, local) = remote_pair();
    remote_commit(&remote, "remote.txt");
    let expected = changes::head(&remote.0);
    action(&local, "update", None, "merge").unwrap();
    assert_eq!(changes::head(&local.0), expected);
    action(&local, "update", None, "merge").unwrap();
    assert_eq!(changes::head(&local.0), expected);
    assert!(changes::read(&local.0).unwrap().files.is_empty());
    assert!(!local.0.join(".git/MERGE_HEAD").exists());
}

#[test]
fn update_does_not_bypass_a_rejecting_commit_hook() {
    let (remote, local) = remote_pair();
    remote_commit(&remote, "remote.txt");
    local.write("local.txt", "local\n");
    local.git(&["add", "local.txt"]);
    local.git(&["commit", "-m", "local"]);
    let head = changes::head(&local.0);
    commit_hook(&local, "#!/bin/sh\nexit 1\n");
    assert!(matches!(
        action(&local, "update", None, "merge"),
        Err(GitError::Integrate)
    ));
    assert_eq!(changes::head(&local.0), head);
    assert!(local.0.join(".git/MERGE_HEAD").exists());
    assert_eq!(
        output(&local.0, &["show", ":remote.txt"]).unwrap(),
        "remote change"
    );
}
