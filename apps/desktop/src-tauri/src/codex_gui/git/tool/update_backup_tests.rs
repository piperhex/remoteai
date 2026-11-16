use super::super::{command, output};
use super::{tests::Repo, update_backup, GitError};
use std::{fs, path::Path, process::Child};

fn stash_ids(root: &Path) -> Vec<String> {
    output(root, &["stash", "list", "--format=%H"])
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect()
}

fn assert_retained(root: &Path, backup: &update_backup::Backup) {
    assert_eq!(
        output(
            root,
            &["rev-parse", &format!("refs/remoteai/update/{}", backup.id)]
        )
        .unwrap(),
        backup.stash.as_deref().unwrap()
    );
    assert!(update_backup::read(root).unwrap().is_none());
}

fn wait_for_git(child: Child) {
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

fn linked_worktree(repo: &Repo) -> tempfile::TempDir {
    let linked = tempfile::tempdir().unwrap();
    repo.git(&[
        "worktree",
        "add",
        "--detach",
        &crate::codex_gui::platform::execution_path(linked.path()),
        "HEAD",
    ]);
    linked
}

#[test]
fn explicit_restore_and_acknowledgement_keep_stashes_and_pins() {
    for restored in [true, false] {
        let repo = Repo::new(true);
        repo.write("one.txt", "saved index\n");
        repo.git(&["add", "one.txt"]);
        repo.write("one.txt", "saved worktree\n");
        repo.write("new.txt", "saved untracked\n");
        let backup = update_backup::save(&repo.0, false).unwrap();
        let before = stash_ids(&repo.0);
        if restored {
            repo.git(&[
                "stash",
                "apply",
                "--index",
                backup.stash.as_deref().unwrap(),
            ]);
        }
        backup.finish(&repo.0, restored).unwrap();
        assert_retained(&repo.0, &backup);
        assert_eq!(stash_ids(&repo.0), before);
        let oid = backup.stash.as_deref().unwrap();
        for (revision, expected) in [
            (format!("{oid}^2:one.txt"), "saved index"),
            (format!("{oid}:one.txt"), "saved worktree"),
            (format!("{oid}^3:new.txt"), "saved untracked"),
        ] {
            assert_eq!(output(&repo.0, &["show", &revision]).unwrap(), expected);
        }
    }
}

#[test]
fn ordinal_changes_in_another_worktree_do_not_change_cleanup_targets() {
    let repo = Repo::new(true);
    repo.write("one.txt", "older backup\n");
    repo.git(&["stash", "push", "-m", "older"]);
    repo.write("one.txt", "owned backup\n");
    let backup = update_backup::save(&repo.0, false).unwrap();
    let linked = linked_worktree(&repo);
    fs::write(linked.path().join("one.txt"), "other worktree\n").unwrap();
    wait_for_git(
        command(linked.path())
            .args(["stash", "push", "-m", "newer"])
            .spawn()
            .unwrap(),
    );
    assert_eq!(stash_ids(&repo.0)[1], backup.stash.as_deref().unwrap());
    let before = stash_ids(&repo.0);
    backup.finish(&repo.0, true).unwrap();
    assert_eq!(stash_ids(&repo.0), before);
    assert_retained(&repo.0, &backup);

    // A deletion shifts the owned entry back to zero; cleanup must still leave the shared list alone.
    backup.write(&repo.0).unwrap();
    wait_for_git(
        command(linked.path())
            .args(["stash", "drop", "stash@{0}"])
            .spawn()
            .unwrap(),
    );
    assert_eq!(stash_ids(&repo.0)[0], backup.stash.as_deref().unwrap());
    let before = stash_ids(&repo.0);
    backup.finish(&repo.0, true).unwrap();
    assert_eq!(stash_ids(&repo.0), before);
    assert_retained(&repo.0, &backup);
}

#[test]
fn cleanup_preserves_backups_during_cross_process_stash_push_and_drop() {
    let repo = Repo::new(true);
    repo.write("one.txt", "owned backup\n");
    let backup = update_backup::save(&repo.0, false).unwrap();
    let linked = linked_worktree(&repo);
    let baseline = stash_ids(&repo.0);
    for iteration in 0..4 {
        fs::write(
            linked.path().join("one.txt"),
            format!("other backup {iteration}\n"),
        )
        .unwrap();
        backup.write(&repo.0).unwrap();
        let push = command(linked.path())
            .args(["stash", "push", "-m", "concurrent"])
            .spawn()
            .unwrap();
        // The independent Git process may move the shared reflog while cleanup runs.
        let finished = backup.finish(&repo.0, true);
        wait_for_git(push);
        finished.unwrap();
        let after_push = stash_ids(&repo.0);
        assert_eq!(after_push.len(), baseline.len() + 1);
        assert_eq!(after_push[1..], baseline);
        assert_eq!(
            output(
                linked.path(),
                &["show", &format!("{}:one.txt", after_push[0])]
            )
            .unwrap(),
            format!("other backup {iteration}")
        );
        assert_retained(&repo.0, &backup);

        backup.write(&repo.0).unwrap();
        let drop = command(linked.path())
            .args(["stash", "drop", "stash@{0}"])
            .spawn()
            .unwrap();
        let finished = backup.finish(&repo.0, true);
        wait_for_git(drop);
        finished.unwrap();
        assert_eq!(stash_ids(&repo.0), baseline);
        assert_retained(&repo.0, &backup);
    }
}

#[test]
fn removed_stash_entry_does_not_remove_its_durable_backup() {
    let repo = Repo::new(true);
    repo.write("one.txt", "owned backup\n");
    let backup = update_backup::save(&repo.0, false).unwrap();
    let linked = linked_worktree(&repo);
    wait_for_git(
        command(linked.path())
            .args(["stash", "drop", "stash@{0}"])
            .spawn()
            .unwrap(),
    );
    backup.finish(&repo.0, true).unwrap();
    assert!(stash_ids(&repo.0).is_empty());
    assert_retained(&repo.0, &backup);
}

#[test]
fn native_cleanup_rejects_a_replaced_safety_ref() {
    let repo = Repo::new(true);
    repo.write("one.txt", "original backup\n");
    let backup = update_backup::save(&repo.0, true).unwrap();
    repo.write("one.txt", "replacement backup\n");
    let replacement = output(&repo.0, &["stash", "create"]).unwrap();
    let reference = format!("refs/remoteai/update/{}", backup.id);
    repo.git(&["update-ref", &reference, &replacement]);
    assert!(matches!(
        backup.finish(&repo.0, true),
        Err(GitError::UpdateRestore)
    ));
    assert_eq!(
        output(&repo.0, &["rev-parse", &reference]).unwrap(),
        replacement
    );
    assert!(update_backup::read(&repo.0).unwrap().is_some());
}
