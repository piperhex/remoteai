use super::*;
use crate::codex_gui::{git, protocol::GuiEvent, turn_review, worktree_observation::Baseline};
use std::io::Write;
use std::process::{Command, Stdio};
use tempfile::TempDir;

fn command(dir: &Path, args: &[&str]) {
    let out = git::run(dir, args).unwrap();
    assert!(
        out.status.success(),
        "{args:?} {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn repo() -> TempDir {
    let root = tempfile::tempdir().unwrap();
    let cwd = root.path();
    command(cwd, &["init", "-b", "main"]);
    for (key, value) in [
        ("user.name", "Review"),
        ("user.email", "review@example.invalid"),
        ("commit.gpgsign", "false"),
        ("core.autocrlf", "false"),
    ] {
        command(cwd, &["config", key, value]);
    }
    fs::write(cwd.join("A.txt"), b"before\nkeep\n").unwrap();
    fs::write(cwd.join("C.txt"), b"clean\n").unwrap();
    command(cwd, &["add", "."]);
    command(cwd, &["commit", "-m", "base"]);
    root
}

const EDIT: &str = "@@ -1,2 +1,2 @@\n-before\n+after\n keep\n";
const B: &str = "新 文件.txt";

fn patch(root: &Path, hunk: &str) -> String {
    let bytes = format!("diff --git a/A.txt b/A.txt\n--- a/A.txt\n+++ b/A.txt\n{hunk}");
    let mut child = git::command(root)
        .args(["apply", "-"])
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(bytes.as_bytes())
        .unwrap();
    assert!(child.wait().unwrap().success());
    bytes
}

fn script(root: &Path, payload: &str) {
    let python = if cfg!(windows) { "py" } else { "python3" };
    let result = Command::new(python).current_dir(root).args(["-c",
        "import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(sys.argv[2].encode()); sys.exit(7)",
        B,payload]).status().unwrap();
    assert_eq!(result.code(), Some(7));
}

fn event(home: &Path, thread: &str, method: &str, mut params: Value, cwd: Option<&Path>) {
    params["threadId"] = json!(thread);
    params["turnId"] = json!("turn");
    let event = GuiEvent {
        method: method.into(),
        params,
        id: None,
    };
    assert!(turn_review::observes(&event));
    turn_review::record(home, &event, cwd.map(|path| path.to_str().unwrap().into())).unwrap();
}

fn edit(home: &Path, thread: &str, diff: &str, hunk: &str) {
    event(
        home,
        thread,
        "item/completed",
        json!({"item":{"id":"tool","type":"fileChange","status":"completed",
        "changes":[{"path":"A.txt","kind":{"type":"update"},"diff":hunk}]}}),
        None,
    );
    event(
        home,
        thread,
        "turn/diff/updated",
        json!({"diff":diff}),
        None,
    );
}

fn history(home: &Path, thread: &str) -> Value {
    let mut value = json!({"id":thread, "turns":[{"id":"turn","status":"completed","items":[]}]});
    turn_review::restore(home, &mut value).unwrap();
    value
}

fn git_files(cwd: &Path) -> Value {
    git::tool::test_request(json!({"operation":"changes","cwd":cwd}))["files"].take()
}

#[test]
fn mixed_tools_failure_history_and_undo_keep_dirty_and_unattributed_files() {
    let original = repo();
    let host = tempfile::tempdir().unwrap();
    let checkout = host.path().join("linked");
    fs::write(original.path().join("C.txt"), "source-only change\n").unwrap();
    command(
        original.path(),
        &[
            "worktree",
            "add",
            "-b",
            "task",
            checkout.to_str().unwrap(),
            "HEAD",
        ],
    );
    assert_eq!(
        fs::read_to_string(checkout.join("C.txt")).unwrap(),
        "clean\n"
    );
    fs::write(checkout.join("C.txt"), "already dirty\n").unwrap();
    let before = Baseline::start(checkout.to_str().unwrap()).unwrap();
    event(
        host.path(),
        "first",
        "turn/started",
        json!({"turn":{"id":"turn"}}),
        Some(&checkout),
    );
    let diff = patch(&checkout, EDIT);
    edit(host.path(), "first", &diff, EDIT);
    script(&checkout, "from Python");
    let files = git_files(&checkout);
    for path in ["A.txt", B, "C.txt"] {
        assert!(files
            .as_array()
            .unwrap()
            .iter()
            .any(|file| file["path"] == path));
    }
    let new = git::tool::test_request(
        json!({"operation":"diff","scope":"unstaged","path":B,"cwd":checkout}),
    );
    assert!(new["text"].as_str().unwrap().contains("+from Python"));
    command(&checkout, &["add", "--", B]);
    command(&checkout, &["commit", "-m", "during turn"]);
    event(
        host.path(),
        "first",
        "turn/completed",
        json!({"turn":{"status":"failed",
        "workspaceObservation":before.finish()}}),
        None,
    );
    let saved = history(host.path(), "first");
    let turn = &saved["turns"][0];
    assert_eq!(
        turn["workspaceObservation"],
        json!({"paths":["A.txt",B],"complete":true})
    );
    assert_eq!(turn["diff"], diff);
    assert_eq!(turn["reviewCwd"], checkout.to_str().unwrap());
    let edits = changes(&saved, "turn").unwrap();
    assert_eq!(edits.len(), 1);
    assert_eq!(edits[0].path, "A.txt");
    let root = checkout.canonicalize().unwrap();
    execute(&root, edits, &host.path().join("receipt")).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("A.txt")).unwrap(),
        "before\nkeep\n"
    );
    assert_eq!(
        fs::read_to_string(root.join("C.txt")).unwrap(),
        "already dirty\n"
    );
    assert_eq!(fs::read_to_string(root.join(B)).unwrap(), "from Python");
    assert_eq!(git_files(&root)[0]["path"], "C.txt");
}

#[test]
fn shared_writers_conflict_and_separate_worktrees_with_identical_paths() {
    let source = repo();
    let host = tempfile::tempdir().unwrap();
    assert!(Baseline::start(source.path().to_str().unwrap()).is_none());
    let first = host.path().join("first-worktree");
    command(
        source.path(),
        &[
            "worktree",
            "add",
            "-b",
            "first",
            first.to_str().unwrap(),
            "HEAD",
        ],
    );
    let cwd = first.as_path();
    let other = host.path().join("other");
    command(
        cwd,
        &[
            "worktree",
            "add",
            "-b",
            "other",
            other.to_str().unwrap(),
            "HEAD",
        ],
    );
    for (id, root) in [("one", cwd), ("two", cwd), ("elsewhere", other.as_path())] {
        event(
            host.path(),
            id,
            "turn/started",
            json!({"turn":{"id":"turn"}}),
            Some(root),
        );
    }
    let diff = patch(cwd, EDIT);
    edit(host.path(), "one", &diff, EDIT);
    let later = "@@ -1,2 +1,2 @@\n-after\n+another writer\n keep\n";
    let diff = patch(cwd, later);
    edit(host.path(), "two", &diff, later);
    let diff = patch(&other, EDIT);
    edit(host.path(), "elsewhere", &diff, EDIT);
    for id in ["one", "two", "elsewhere"] {
        event(
            host.path(),
            id,
            "turn/completed",
            json!({"turn":{"status":"interrupted"}}),
            None,
        );
    }
    for (id, expected) in [("one", cwd), ("elsewhere", other.as_path())] {
        let saved = history(host.path(), id);
        assert_eq!(saved["turns"][0]["reviewCwd"], expected.to_str().unwrap());
        let edits = changes(&saved, "turn").unwrap();
        let receipt = host.path().join(id);
        let root = expected.canonicalize().unwrap();
        let preview = preview(&root, &edits, &receipt).unwrap();
        assert_eq!(preview.conflict, id == "one");
        assert_eq!(execute(&root, edits, &receipt).is_ok(), id != "one");
    }
    assert_eq!(
        fs::read_to_string(cwd.join("A.txt")).unwrap(),
        "another writer\nkeep\n"
    );
    assert_eq!(
        fs::read_to_string(other.join("A.txt")).unwrap(),
        "before\nkeep\n"
    );
}

#[test]
fn staged_and_unstaged_diffs_use_distinct_images_including_recreated_paths() {
    let repo = repo();
    let cwd = repo.path();
    fs::write(cwd.join("A.txt"), "staged\n").unwrap();
    command(cwd, &["add", "A.txt"]);
    fs::write(cwd.join("A.txt"), "working\n").unwrap();
    let diff = |scope: &str| {
        git::tool::test_request(json!({"operation":"diff","scope":scope,"path":"A.txt","cwd":cwd}))
            ["text"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    assert_eq!(git_files(cwd)[0]["status"], "MM");
    assert!(diff("staged").contains("+staged"));
    assert!(!diff("staged").contains("+working"));
    assert!(diff("unstaged").contains("-staged\n+working"));
    command(cwd, &["rm", "-f", "--cached", "A.txt"]);
    assert!(diff("staged").contains("-before"));
    assert!(diff("unstaged").contains("+working"));
}

#[test]
fn scoped_changes_include_renames_binary_files_and_submodule_contents() {
    let source = repo();
    let child = repo();
    let cwd = source.path();
    command(
        cwd,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            child.path().to_str().unwrap(),
            "module",
        ],
    );
    command(cwd, &["commit", "-m", "module"]);
    fs::write(cwd.join("module/A.txt"), "changed child\n").unwrap();
    fs::write(cwd.join("image.bin"), [0, 1, 2, 0]).unwrap();
    command(cwd, &["mv", "A.txt", "新 文件.txt"]);
    fs::remove_file(cwd.join("C.txt")).unwrap();
    let rows = git_files(cwd);
    let rows = rows.as_array().unwrap();
    assert!(rows
        .iter()
        .any(|r| r["originalPath"] == "A.txt" && r["status"] == "R "));
    assert!(rows
        .iter()
        .any(|r| r["path"] == "C.txt" && r["status"] == " D"));
    assert!(rows
        .iter()
        .any(|r| r["path"] == "module" && r["submodule"] == true));
    for (root, path, scope, text) in [
        (cwd.to_owned(), "新 文件.txt", "staged", "rename from A.txt"),
        (cwd.to_owned(), "image.bin", "unstaged", "Binary files"),
        (cwd.to_owned(), "C.txt", "unstaged", "-clean"),
        (cwd.join("module"), "A.txt", "unstaged", "+changed child"),
    ] {
        let result = git::tool::test_request(
            json!({"operation":"diff","scope":scope,"path":path,"cwd":root}),
        );
        assert!(result["text"].as_str().unwrap().contains(text), "{result}");
    }
}

#[test]
fn restored_empty_diff_keeps_activity_after_restart_but_has_no_undo() {
    let repo = repo();
    let home = tempfile::tempdir().unwrap();
    event(
        home.path(),
        "id",
        "turn/started",
        json!({"turn":{"id":"turn"}}),
        Some(repo.path()),
    );
    let diff = patch(repo.path(), EDIT);
    edit(home.path(), "id", &diff, EDIT);
    let reverse = "@@ -1,2 +1,2 @@\n-after\n+before\n keep\n";
    patch(repo.path(), reverse);
    event(
        home.path(),
        "id",
        "item/completed",
        json!({"item":{"id":"reverse","type":"fileChange","status":"completed",
            "changes":[{"path":"A.txt","kind":{"type":"update"},"diff":reverse}]}}),
        None,
    );
    event(
        home.path(),
        "id",
        "turn/completed",
        json!({"turn":{"status":"completed"}}),
        None,
    );
    let restored = history(home.path(), "id");
    assert_eq!(restored["turns"][0]["diff"], "");
    assert_eq!(restored["turns"][0]["reviewEdits"][0]["id"], "tool");
    assert!(changes(&restored, "turn").is_err());
    assert_eq!(git_files(repo.path()), json!([]));
}

#[test]
fn non_git_history_keeps_tool_records_and_a_missing_completion_is_incomplete() {
    let host = tempfile::tempdir().unwrap();
    let cwd = tempfile::tempdir().unwrap();
    event(
        host.path(),
        "local",
        "turn/started",
        json!({"turn":{"id":"turn"}}),
        Some(cwd.path()),
    );
    fs::write(cwd.path().join("result"), "new").unwrap();
    event(
        host.path(),
        "local",
        "item/completed",
        json!({"item":{"id":"write","type":"fileChange",
        "status":"completed","changes":[{"path":"result","kind":{"type":"add"},"diff":"new"}]}}),
        None,
    );
    assert!(changes(&history(host.path(), "local"), "turn").is_err());
    event(
        host.path(),
        "local",
        "turn/completed",
        json!({"turn":{"status":"completed"}}),
        None,
    );
    let saved = history(host.path(), "local");
    assert!(saved["turns"][0]["diff"].is_null());
    assert_eq!(saved["turns"][0]["reviewIncomplete"], false);
    let root = cwd.path().canonicalize().unwrap();
    execute(
        &root,
        changes(&saved, "turn").unwrap(),
        &host.path().join("undo"),
    )
    .unwrap();
    assert!(!root.join("result").exists());
}
