use super::super::output;
use super::action_tests::{action, remote_commit, remote_pair};
use super::{integration, update, update_backup, GitError};
use std::fs;

#[test]
fn all_update_methods_restore_staged_unstaged_and_untracked_files() {
    for operation in ["pull", "update"] {
        for strategy in ["merge", "rebase"] {
            let (remote, local) = remote_pair();
            remote_commit(&remote, "remote.txt");
            local.write("one.txt", "staged\n");
            local.git(&["add", "one.txt"]);
            local.write("one.txt", "unstaged\n");
            local.write("新 文件 [1].txt", "untracked\n");
            action(&local, operation, None, strategy).unwrap();
            assert_eq!(output(&local.0, &["show", ":one.txt"]).unwrap(), "staged");
            assert_eq!(
                fs::read_to_string(local.0.join("one.txt")).unwrap(),
                "unstaged\n"
            );
            assert_eq!(
                fs::read_to_string(local.0.join("新 文件 [1].txt")).unwrap(),
                "untracked\n"
            );
            assert!(local.0.join("remote.txt").exists());
            assert!(update_backup::read(&local.0).unwrap().is_none());
            assert!(output(&local.0, &["stash", "list"]).unwrap().is_empty());
        }
    }
}

#[test]
fn native_autostash_restores_unstaged_changes_and_cleans_its_safety_ref() {
    for strategy in ["merge", "rebase"] {
        let (remote, local) = remote_pair();
        remote_commit(&remote, "remote.txt");
        local.write("one.txt", "local edit\n");
        action(&local, "update", None, strategy).unwrap();
        assert_eq!(
            fs::read_to_string(local.0.join("one.txt")).unwrap(),
            "local edit\n"
        );
        assert!(output(&local.0, &["for-each-ref", "refs/remoteai/update"])
            .unwrap()
            .is_empty());
        assert!(update_backup::read(&local.0).unwrap().is_none());
    }
}

#[test]
fn native_restore_conflicts_are_failures_even_when_git_exits_successfully() {
    for strategy in ["merge", "rebase"] {
        let (remote, local) = remote_pair();
        remote_commit(&remote, "one.txt");
        local.write("one.txt", "local edit\n");
        assert!(matches!(
            action(&local, "pull", None, strategy),
            Err(GitError::UpdateRestore)
        ));
        let backup = update_backup::read(&local.0).unwrap().unwrap();
        assert!(backup.native);
        let oid = backup.stash.unwrap();
        assert_eq!(
            output(&local.0, &["show", &format!("{oid}:one.txt")]).unwrap(),
            "local edit"
        );
        assert!(update::has_conflicts(&local.0).unwrap());
        local.write("one.txt", "resolved\n");
        local.git(&["add", "one.txt"]);
        let state = integration::read(&local.0).unwrap().unwrap();
        integration::resume(&local.0, &state.version).unwrap();
        assert_eq!(
            output(&local.0, &["show", &format!("{oid}:one.txt")]).unwrap(),
            "local edit"
        );
        assert!(integration::read(&local.0).unwrap().is_none());
    }
}

#[test]
fn integration_conflicts_keep_backups_and_continue_restores_local_changes() {
    for strategy in ["merge", "rebase"] {
        for untracked in [false, true] {
            let (remote, local) = remote_pair();
            remote_commit(&remote, "one.txt");
            local.write("one.txt", "local commit\n");
            local.git(&["commit", "-am", "local"]);
            local.write("two.txt", "uncommitted\n");
            if untracked {
                local.write("new.txt", "untracked\n");
            }
            assert!(matches!(
                action(&local, "update", None, strategy),
                Err(GitError::Integrate)
            ));
            assert!(update_backup::read(&local.0).unwrap().is_some());
            local.write("one.txt", "resolved\n");
            local.git(&["add", "one.txt"]);
            let state = integration::read(&local.0).unwrap().unwrap();
            integration::resume(&local.0, &state.version).unwrap();
            assert_eq!(
                fs::read_to_string(local.0.join("two.txt")).unwrap(),
                "uncommitted\n"
            );
            if untracked {
                assert_eq!(
                    fs::read_to_string(local.0.join("new.txt")).unwrap(),
                    "untracked\n"
                );
            }
            assert!(update_backup::read(&local.0).unwrap().is_none());
        }
    }
}

#[test]
fn untracked_collision_retains_both_versions_and_never_reapplies_partial_restore() {
    let (remote, local) = remote_pair();
    remote_commit(&remote, "new.txt");
    local.write("new.txt", "local untracked\n");
    local.write("two.txt", "local edit\n");
    assert!(matches!(
        action(&local, "pull", None, "merge"),
        Err(GitError::UpdateRestore)
    ));
    let backup = update_backup::read(&local.0).unwrap().unwrap();
    let oid = backup.stash.unwrap();
    assert_eq!(
        output(&local.0, &["show", &format!("{oid}^3:new.txt")]).unwrap(),
        "local untracked"
    );
    assert_eq!(
        fs::read_to_string(local.0.join("new.txt")).unwrap(),
        "remote change\n"
    );
    assert_eq!(
        fs::read_to_string(local.0.join("two.txt")).unwrap(),
        "local edit\n"
    );
    assert!(matches!(
        action(&local, "pull", None, "merge"),
        Err(GitError::UpdatePending)
    ));
    let state = integration::read(&local.0).unwrap().unwrap();
    integration::resume(&local.0, &state.version).unwrap();
    assert!(integration::resume(&local.0, &state.version).is_err());
    assert!(output(&local.0, &["stash", "list"])
        .unwrap()
        .contains(&backup.id));
}

#[test]
fn preexisting_stashes_renames_and_deletions_survive() {
    let (remote, local) = remote_pair();
    local.write("one.txt", "older stash\n");
    local.git(&["stash", "push", "-m", "unrelated"]);
    let before = output(&local.0, &["rev-parse", "refs/stash"]).unwrap();
    remote_commit(&remote, "remote.txt");
    local.git(&["mv", "one.txt", "renamed.txt"]);
    fs::remove_file(local.0.join("two.txt")).unwrap();
    action(&local, "update", None, "rebase").unwrap();
    assert!(local.0.join("renamed.txt").exists());
    assert!(!local.0.join("one.txt").exists());
    assert!(!local.0.join("two.txt").exists());
    assert_eq!(
        output(&local.0, &["rev-parse", "refs/stash"]).unwrap(),
        before
    );
}

#[test]
fn network_failure_leaves_all_local_files_and_index_untouched() {
    let (_remote, local) = remote_pair();
    local.git(&["remote", "set-url", "origin", "nonexistent-remote"]);
    local.write("one.txt", "staged\n");
    local.git(&["add", "one.txt"]);
    local.write("one.txt", "unstaged\n");
    local.write("new.txt", "untracked\n");
    assert!(matches!(
        action(&local, "pull", None, "rebase"),
        Err(GitError::Network)
    ));
    assert_eq!(output(&local.0, &["show", ":one.txt"]).unwrap(), "staged");
    assert_eq!(
        fs::read_to_string(local.0.join("one.txt")).unwrap(),
        "unstaged\n"
    );
    assert_eq!(
        fs::read_to_string(local.0.join("new.txt")).unwrap(),
        "untracked\n"
    );
    assert!(update_backup::read(&local.0).unwrap().is_none());
}

#[test]
fn native_restore_failure_without_unmerged_files_keeps_its_backup() {
    let (remote, local) = remote_pair();
    remote_commit(&remote, "remote.txt");
    local.write("one.txt", "local edit\n");
    let hook = local.0.join(".git/hooks/post-merge");
    fs::write(&hook, "#!/bin/sh\nprintf locked > .git/index.lock\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
    assert!(matches!(
        action(&local, "pull", None, "merge"),
        Err(GitError::UpdateRestore)
    ));
    assert!(!update::has_conflicts(&local.0).unwrap());
    let backup = update_backup::read(&local.0).unwrap().unwrap();
    assert!(backup.native);
    assert!(update_backup::stash_head(&local.0).unwrap().is_some());
    assert_eq!(
        output(
            &local.0,
            &["show", &format!("{}:one.txt", backup.stash.unwrap())]
        )
        .unwrap(),
        "local edit"
    );
}

#[test]
fn interrupted_apply_requires_review_and_never_duplicates_changes() {
    let (_remote, local) = remote_pair();
    local.write("new.txt", "untracked\n");
    let mut backup = update_backup::save(&local.0, false).unwrap();
    backup.phase = update_backup::Phase::Applying;
    backup.write(&local.0).unwrap();
    let state = integration::read(&local.0).unwrap().unwrap();
    integration::resume(&local.0, &state.version).unwrap();
    assert!(!local.0.join("new.txt").exists());
    assert!(output(&local.0, &["stash", "list"])
        .unwrap()
        .contains(&backup.id));
}
