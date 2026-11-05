use super::super::{output, repository};
use super::{changes, commit, file_actions, repositories, tests::Repo, GitError, SelectedFile};
use crate::codex_gui::platform::execution_path;
use std::{fs, path::Path};

fn add_child(parent: &Repo, source: &Repo, path: &str) {
    parent.git(&[
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        &execution_path(&source.0),
        path,
    ]);
    parent.git(&["commit", "-am", "add child"]);
    let child = Repo(parent.0.join(path));
    child.git(&["config", "user.name", "Test"]);
    child.git(&["config", "user.email", "test@example.invalid"]);
    child.git(&["config", "commit.gpgsign", "false"]);
    // The parent owns the checkout's lifetime.
    std::mem::forget(child);
}

fn selection(root: &Path, path: &str) -> (Option<String>, Vec<SelectedFile>) {
    let current = changes::read(root).unwrap();
    let file = current.files.iter().find(|file| file.path == path).unwrap();
    (
        current.head,
        vec![SelectedFile {
            path: file.path.clone(),
            version: file.version.clone(),
        }],
    )
}

#[test]
fn discovers_recursive_submodules_and_missing_checkouts_from_worktrees() {
    let grandchild = Repo::new(true);
    let source = Repo::new(true);
    add_child(&source, &grandchild, "nested child");
    let parent = Repo::new(true);
    add_child(&parent, &source, "packages/子 项目");
    let entries = repositories::read(&parent.0).unwrap();
    assert_eq!(
        entries
            .iter()
            .map(|entry| (entry.path.as_str(), entry.available))
            .collect::<Vec<_>>(),
        vec![
            ("", true),
            ("packages/子 项目", true),
            ("packages/子 项目/nested child", false)
        ]
    );
    parent.git(&[
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "update",
        "--init",
        "--recursive",
    ]);
    assert!(repositories::read(&parent.0)
        .unwrap()
        .iter()
        .all(|entry| entry.available));
    let tree = parent.0.join("linked-tree");
    parent.git(&["worktree", "add", "-b", "linked", &execution_path(&tree)]);
    let entries = repositories::read(&tree).unwrap();
    assert_eq!(entries.len(), 2);
    assert!(!entries[1].available);
    assert!(matches!(
        repository(&tree.join("packages/子 项目")),
        Err(GitError::Repository)
    ));
}

#[test]
fn child_commits_and_parent_reference_commits_remain_separate_and_detect_stale_heads() {
    let source = Repo::new(true);
    let parent = Repo::new(true);
    add_child(&parent, &source, "child");
    let child = parent.0.join("child");
    let original_parent = changes::head(&parent.0);
    fs::write(child.join("one.txt"), "child edit\n").unwrap();
    assert_eq!(
        changes::read(&parent.0).unwrap().files[0].reference_changed,
        Some(false)
    );
    let (head, files) = selection(&child, "one.txt");
    commit::create(&child, head.as_deref(), "child commit", &files).unwrap();
    assert_eq!(changes::head(&parent.0), original_parent);
    assert!(changes::read(&parent.0)
        .unwrap()
        .files
        .iter()
        .any(|file| file.path == "child" && file.submodule));
    assert_eq!(
        changes::read(&parent.0).unwrap().files[0].reference_changed,
        Some(true)
    );
    let (parent_head, stale) = selection(&parent.0, "child");
    fs::write(child.join("one.txt"), "another child edit\n").unwrap();
    let (head, files) = selection(&child, "one.txt");
    let child_head =
        commit::create(&child, head.as_deref(), "another child commit", &files).unwrap();
    assert!(matches!(
        commit::create(&parent.0, parent_head.as_deref(), "stale", &stale),
        Err(GitError::Changed)
    ));
    let (head, files) = selection(&parent.0, "child");
    commit::create(&parent.0, head.as_deref(), "update child reference", &files).unwrap();
    assert_eq!(
        output(&parent.0, &["rev-parse", "HEAD:child"]).unwrap(),
        child_head
    );
    assert!(changes::read(&parent.0).unwrap().files.is_empty());
}

#[test]
fn submodule_changes_are_visible_and_directory_actions_do_not_touch_children() {
    let source = Repo::new(true);
    let parent = Repo::new(true);
    add_child(&parent, &source, "child");
    parent.git(&["config", "submodule.child.ignore", "all"]);
    fs::write(parent.0.join("child/one.txt"), "keep child work\n").unwrap();
    let (head, files) = selection(&parent.0, "child");
    for action in [file_actions::Action::Rollback, file_actions::Action::Delete] {
        assert!(file_actions::execute(&parent.0, head.as_deref(), action, &files).is_err());
    }
    assert_eq!(
        fs::read_to_string(parent.0.join("child/one.txt")).unwrap(),
        "keep child work\n"
    );
    parent.git(&["config", "submodule.recurse", "true"]);
    let request = serde_json::from_value(serde_json::json!({
        "operation": "revision", "action": "reset", "cwd": execution_path(&parent.0),
        "head": head, "commit": head, "branch": "main", "mode": "hard",
        "files": files.iter().map(|file| serde_json::json!({ "path": file.path, "version": file.version }))
            .collect::<Vec<_>>()
    })).unwrap();
    super::execute(request).unwrap();
    assert_eq!(
        fs::read_to_string(parent.0.join("child/one.txt")).unwrap(),
        "keep child work\n"
    );
    parent.git(&["submodule", "deinit", "--force", "child"]);
    assert!(!repositories::read(&parent.0).unwrap()[1].available);
    assert!(matches!(
        repository(&parent.0.join("child")),
        Err(GitError::Repository)
    ));
    fs::create_dir(parent.0.join("ordinary-folder")).unwrap();
    assert_eq!(
        repository(&parent.0.join("ordinary-folder")).unwrap(),
        parent.0
    );
}

#[test]
fn discovery_is_opt_in_for_existing_clients() {
    let parent = Repo::new(true);
    let old = serde_json::json!({ "operation": "repository", "cwd": parent.0.to_str().unwrap() });
    let response = super::execute(serde_json::from_value(old.clone()).unwrap()).unwrap();
    assert!(serde_json::to_value(response)
        .unwrap()
        .get("repositories")
        .is_none());
    let mut new = old;
    new["includeChildren"] = true.into();
    let response = super::execute(serde_json::from_value(new).unwrap()).unwrap();
    assert_eq!(
        serde_json::to_value(response).unwrap()["repositories"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
