use super::*;
use crate::codex_gui::{protocol::GuiEvent, turn_review};

fn record(home: &Path, method: &str, mut params: Value) {
    params["threadId"] = json!("thread");
    params["turnId"] = json!("one");
    turn_review::record(
        home,
        &GuiEvent {
            id: None,
            method: method.into(),
            params,
        },
        None,
    )
    .unwrap();
}

fn target() -> Target {
    serde_json::from_value(json!({"threadId":"thread","turnId":"one"})).unwrap()
}

#[test]
fn file_lists_exclude_binary_payloads_and_headerless_patch_content() {
    for patch in [
        "diff --git a/icon b/icon\nGIT binary patch\nliteral 4\n123456789\n",
        "123456789\n",
    ] {
        let dir = tempfile::tempdir().unwrap();
        record(dir.path(), "turn/completed", json!({"diff":patch}));
        let mut target = target();
        let page = saved(dir.path(), &target).unwrap();
        assert!(!page.to_string().contains("123456789"));
        target.file = Some(0);
        assert_eq!(saved(dir.path(), &target).unwrap()["text"], patch);
    }
}

#[test]
fn scrolling_history_and_paging_file_lists_work_without_readable_bodies() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    let changes: Vec<_> = (0..PAGE * 2 + 1)
        .map(|index| {
            json!({
                "path":format!("file-{index}"),"kind":{"type":"add"},"diff":"first\nsecond\n"
            })
        })
        .collect();
    record(home, "turn/started", json!({}));
    record(
        home,
        "turn/completed",
        json!({"turn":{"items":[
        {"id":"failed","status":"failed","type":"fileChange","changes":[
            {"path":"other","kind":{"type":"delete"},"diff":"old"}]},
        {"id":"edit","status":"completed","type":"fileChange","changes":changes}]}}),
    );
    let db = turn_review::open(home).unwrap();
    // Any attempt to restore the turn or fetch a body now fails at SQLite's read boundary.
    db.execute_batch(
        "ALTER TABLE turns RENAME COLUMN diff TO inaccessible_patch;
        ALTER TABLE edits RENAME COLUMN body TO inaccessible_edit;
        ALTER TABLE review_bodies RENAME COLUMN data TO inaccessible_file;",
    )
    .unwrap();
    let mut history = json!({"id":"thread","turns":[{"id":"one","status":"completed"}]});
    turn_review::restore_page(home, &mut history).unwrap();
    assert_eq!(history["turns"][0]["reviewDeferred"], "tools");
    let mut target = target();
    for offset in [0, PAGE, PAGE * 2] {
        target.offset = offset;
        let page = saved(home, &target).unwrap();
        assert_eq!(page["files"][0]["path"], format!("file-{offset}"));
        assert_eq!(page["files"][0]["added"], 2);
        assert_eq!(page["files"][0]["removed"], 0);
        assert_eq!(
            page["next"],
            json!((offset < PAGE * 2).then_some(offset + PAGE))
        );
    }
    target.activity = true;
    target.offset = 0;
    assert_eq!(saved(home, &target).unwrap()["files"][0]["removed"], 1);
    db.execute_batch("ALTER TABLE review_bodies RENAME COLUMN inaccessible_file TO data")
        .unwrap();
    target.file = Some(0);
    assert_eq!(saved(home, &target).unwrap()["text"], "old");
    target.activity = false;
    assert_eq!(saved(home, &target).unwrap()["text"], "first\nsecond\n");
}

#[test]
fn late_events_and_retried_completions_replace_both_file_views_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    let item = |text: &str| {
        json!({"id":"edit","status":"completed","type":"fileChange",
        "changes":[{"path":"A","kind":{"type":"add"},"diff":text}]})
    };
    record(home, "turn/started", json!({}));
    record(
        home,
        "turn/completed",
        json!({"turn":{"items":[item("old")]}}),
    );
    record(home, "item/completed", json!({"item":item("new\nlines")}));
    let mut target = target();
    assert_eq!(saved(home, &target).unwrap()["files"][0]["added"], 2);
    for _ in 0..2 {
        record(home, "turn/completed", json!({"turn":{"diff":""}}));
    }
    assert_eq!(saved(home, &target).unwrap()["files"], json!([]));
    target.activity = true;
    target.file = Some(0);
    assert_eq!(saved(home, &target).unwrap()["text"], "new\nlines");
    target.offset = usize::MAX;
    assert!(matches!(
        saved(home, &target),
        Err(GuiError::InvalidRequest)
    ));
    let db = turn_review::open(home).unwrap();
    let count: usize = db
        .query_row("SELECT count(*) FROM review_bodies", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn paged_reviews_do_not_depend_on_patch_size() {
    for size in [
        1,
        BODY_PAGE_BYTES - 1,
        BODY_PAGE_BYTES,
        BODY_PAGE_BYTES + 1,
        2 * BODY_PAGE_BYTES,
    ] {
        let mut turn = json!({"status":"completed","diff":"x".repeat(size),"reviewEdits":[]});
        super::super::index::project(&mut turn);
        assert_eq!(turn["reviewDeferred"], "net");
        assert!(turn["diff"].is_null());
    }
    for mut turn in [
        json!({"status":"inProgress","diff":"live"}),
        json!({"status":"completed","diff":null,"reviewEdits":[]}),
    ] {
        super::super::index::project(&mut turn);
        assert!(turn.get("reviewDeferred").is_none());
    }
}

#[test]
fn large_review_reopens_exact_saved_files_and_tool_activity_in_pages() {
    let dir = tempfile::tempdir().unwrap();
    let patch = |path: &str, text: &str| {
        format!(
            "diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -0,0 +1 @@\n+{text}\n"
        )
    };
    let first = patch("大 文件", &"数".repeat(BODY_PAGE_BYTES));
    let second = patch("B", "second");
    let db = super::super::open(dir.path()).unwrap();
    db.execute(
        "INSERT INTO turns VALUES ('thread','one','original',?1,1,1)",
        [format!("{first}{second}")],
    )
    .unwrap();
    let item = json!({"id":"edit","status":"completed","type":"fileChange",
        "changes":[{"path":"B","kind":{"type":"add"},"diff":"second"}]});
    db.execute(
        "INSERT INTO edits VALUES ('thread','one','edit',?1)",
        [item.to_string()],
    )
    .unwrap();
    drop(db);
    let mut history = json!({"id":"thread","turns":[{"id":"one","status":"completed",
        "items":[{"id":"folded","processOutputs":[{"type":"fileChange","id":"edit",
            "changes":[{"path":"B","diff":first}]}]}]}]});
    super::super::restore_page(dir.path(), &mut history).unwrap();
    assert_eq!(history["turns"][0]["reviewDeferred"], "net");
    assert_eq!(history["turns"][0]["reviewCwd"], "original");
    assert!(history.to_string().len() < 512);
    // A legacy journal now has a durable index. Even reopening a large net file no longer needs tool bodies.
    turn_review::open(dir.path())
        .unwrap()
        .execute_batch("ALTER TABLE edits RENAME COLUMN body TO inaccessible_edit")
        .unwrap();
    let mut target: Target =
        serde_json::from_value(json!({"threadId":"thread","turnId":"one"})).unwrap();
    let list = saved(dir.path(), &target).unwrap();
    assert_eq!(list["files"].as_array().unwrap().len(), 2);
    assert_eq!(list["files"][0]["added"], 1);
    assert_eq!(list["files"][0]["removed"], 0);
    assert!(list.to_string().len() < 512);
    target.file = Some(0);
    let mut text = String::new();
    loop {
        let page = saved(dir.path(), &target).unwrap();
        text.push_str(page["text"].as_str().unwrap());
        let Some(next) = page["next"].as_u64() else {
            break;
        };
        target.offset = next as usize;
    }
    assert_eq!(text, first);
    target.offset = first.find('数').unwrap() + 1;
    assert!(matches!(
        saved(dir.path(), &target),
        Err(GuiError::InvalidRequest)
    ));
    target.offset = 0;
    target.file = Some(1);
    assert_eq!(saved(dir.path(), &target).unwrap()["text"], second);
    target.file = Some(0);
    target.activity = true;
    assert_eq!(saved(dir.path(), &target).unwrap()["text"], "second");
    target.file = None;
    assert_eq!(saved(dir.path(), &target).unwrap()["files"][0]["added"], 1);
    target.thread_id = "other".into();
    assert!(saved(dir.path(), &target).is_err());
}
