use super::super::super::platform::execution_path;
use super::*;
use std::fs;

fn git(root: &Path, args: &[&str]) {
    let output = git::command(root)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Alice 中文")
        .env("GIT_AUTHOR_EMAIL", "alice@example.invalid")
        .env("GIT_COMMITTER_NAME", "Alice 中文")
        .env("GIT_COMMITTER_EMAIL", "alice@example.invalid")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn read_file(root: &Path, name: &str) -> Response {
    let path = root.join(name);
    snapshot(Request {
        target: Target {
            cwd: execution_path(root),
            path: name.into(),
            chunk: None,
            window: None,
        },
        revision: revision(&fs::read(path).unwrap()),
    })
    .unwrap()
}

#[test]
fn annotates_unicode_literal_paths_working_edits_and_multiple_commits() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    git(root, &["init"]);
    let name = "中文 [a].unknown";
    fs::write(root.join(name), "first\nsecond\nthird\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-m", "First"]);
    fs::write(root.join(name), "first\nchanged\nthird\n").unwrap();
    git(root, &["commit", "-am", "Second"]);
    fs::write(root.join(name), "first\nchanged\nworking\n").unwrap();
    let result = read_file(root, name);
    assert_eq!(result.status, Status::Ready);
    assert_eq!(result.annotations.commits.len(), 2);
    assert!(result
        .annotations
        .commits
        .iter()
        .all(|commit| commit.author == "Alice 中文"));
    let ranges = &result.annotations.ranges;
    assert_eq!(ranges.len(), 3);
    assert_eq!(
        result.annotations.commits[ranges[0].commit.unwrap()].summary,
        "First"
    );
    assert_eq!(
        result.annotations.commits[ranges[1].commit.unwrap()].summary,
        "Second"
    );
    assert!(ranges[2].commit.is_none());
    assert_eq!(
        fs::read_to_string(root.join(name)).unwrap(),
        "first\nchanged\nworking\n"
    );
}

#[test]
fn handles_non_repositories_untracked_files_empty_files_and_stale_revisions() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("note"), "hello").unwrap();
    assert_eq!(read_file(root, "note").status, Status::NotRepository);
    git(root, &["init"]);
    assert_eq!(read_file(root, "note").status, Status::Untracked);
    git(root, &["add", "."]);
    git(root, &["commit", "-m", "Initial"]);
    fs::write(root.join("note"), "").unwrap();
    assert_eq!(read_file(root, "note").status, Status::Ready);
    fs::write(root.join("new.txt"), "new").unwrap();
    assert_eq!(read_file(root, "new.txt").status, Status::Untracked);
    let request = Request {
        target: Target {
            cwd: execution_path(root),
            path: "note".into(),
            chunk: None,
            window: None,
        },
        revision: "stale".into(),
    };
    assert_eq!(snapshot(request).unwrap().status, Status::Changed);
}

#[test]
fn discovers_nested_repositories_and_files_below_project_subdirectories() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    git(root, &["init"]);
    fs::create_dir(root.join("nested")).unwrap();
    let nested = root.join("nested");
    git(&nested, &["init"]);
    fs::create_dir(nested.join("src")).unwrap();
    fs::write(nested.join("src/code.ts"), "const x = 1;\r\n").unwrap();
    git(&nested, &["add", "."]);
    git(&nested, &["commit", "-m", "Nested"]);
    for (project, path) in [
        (root, "nested/src/code.ts"),
        (nested.as_path(), "src/code.ts"),
        (nested.join("src").as_path(), "code.ts"),
    ] {
        let result = read_file(project, path);
        assert_eq!(result.status, Status::Ready);
        assert_eq!(result.annotations.commits[0].summary, "Nested");
    }
}

#[test]
fn rejects_binary_and_outside_paths() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("binary"), [0, 1, 2]).unwrap();
    fs::write(outside.path().join("secret"), "secret").unwrap();
    for path in [
        "binary".to_owned(),
        execution_path(&outside.path().join("secret")),
    ] {
        let request = Request {
            target: Target {
                cwd: execution_path(dir.path()),
                path,
                chunk: None,
                window: None,
            },
            revision: revision(&[0, 1, 2]),
        };
        assert!(snapshot(request).is_err());
    }
}

#[test]
fn annotates_linked_worktrees_and_committed_renames_without_changing_the_index() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    fs::create_dir(&root).unwrap();
    git(&root, &["init"]);
    fs::write(root.join("old.txt"), "first\nsecond\n").unwrap();
    git(&root, &["add", "."]);
    git(&root, &["commit", "-m", "Original"]);
    git(&root, &["mv", "--", "old.txt", "-new.txt"]);
    git(&root, &["commit", "-m", "Rename"]);
    let linked = dir.path().join("linked");
    git(
        &root,
        &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
    );
    let before = git::command(&linked)
        .args(["status", "--porcelain"])
        .output()
        .unwrap()
        .stdout;
    let result = read_file(&linked, "-new.txt");
    assert_eq!(result.status, Status::Ready);
    assert_eq!(result.annotations.commits[0].summary, "Original");
    let after = git::command(&linked)
        .args(["status", "--porcelain"])
        .output()
        .unwrap()
        .stdout;
    assert_eq!(before, after);
}

#[test]
fn malformed_porcelain_is_rejected() {
    for text in [
        "invalid",
        "0000000000000000000000000000000000000000 1 1 1\nauthor A",
        "0000000000000000000000000000000000000000 1 2 1\nfilename file",
    ] {
        assert!(porcelain::parse(text.lines().map(|line| Ok(line.to_owned()))).is_err());
    }
}
