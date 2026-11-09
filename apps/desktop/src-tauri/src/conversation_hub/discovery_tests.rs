use super::bin_test_support::{Fixture, OTHER, STATE, THREAD};
use super::*;

fn entry(id: &str, updated_at: i64) -> ThreadEntry {
    ThreadEntry {
        session_id: id.into(),
        session_kind: "conversation".into(),
        title: "Same title".into(),
        cwd: String::new(),
        updated_at: Some(updated_at),
        size_bytes: 10,
        match_excerpt: None,
        account_id: None,
        account_email: None,
        account_active: false,
    }
}

#[test]
fn browsing_merges_rollout_copies_by_id_and_preserves_distinct_same_named_threads() {
    let mut old = entry(THREAD, 1);
    old.cwd = "/old-project".into();
    old.match_excerpt = Some("Found in the archived copy".into());
    let entries = merge_thread_entries(vec![old, entry(OTHER, 2), entry(THREAD, 3)]);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].session_id, THREAD);
    assert_eq!(entries[0].updated_at, Some(3));
    assert_eq!(entries[0].cwd, "");
    assert_eq!(entries[0].size_bytes, 20);
    assert_eq!(
        entries[0].match_excerpt.as_deref(),
        Some("Found in the archived copy")
    );
    assert_eq!(entries[1].session_id, OTHER);
    let reversed = merge_thread_entries(vec![entry(THREAD, 3), entry(THREAD, 1)]);
    assert_eq!(reversed[0].updated_at, Some(3));
    assert_eq!(reversed[0].size_bytes, 20);
}

#[test]
fn current_project_directory_overrides_the_original_rollout_in_every_home() {
    let fixture = Fixture::new();
    fixture.sql(
        STATE,
        "ALTER TABLE threads ADD COLUMN cwd TEXT;
        UPDATE threads SET cwd = '' WHERE id = 'thread-a';
        UPDATE threads SET cwd = '/new-project' WHERE id = 'thread-b';",
    );
    fixture.rollout("archived_sessions/rollout-copy.jsonl", THREAD);
    let snapshots = gather_snapshots(&fixture.home).unwrap();
    assert_eq!(snapshots.len(), 3);
    for snapshot in snapshots {
        let expected = if snapshot.session_id == THREAD {
            ""
        } else {
            "/new-project"
        };
        assert_eq!(snapshot.cwd, expected);
    }
}

#[test]
fn homes_without_project_metadata_keep_projectless_threads_and_real_directories() {
    let fixture = Fixture::new();
    let path = fixture.home.join("sessions/rollout-no-project.jsonl");
    fs::write(
        path,
        r#"{"type":"session_meta","payload":{"id":"no-project"}}"#,
    )
    .unwrap();
    let snapshots = gather_snapshots(&fixture.home).unwrap();
    let projectless = snapshots
        .iter()
        .find(|item| item.session_id == "no-project");
    assert_eq!(projectless.unwrap().cwd, "");
    assert!(snapshots
        .iter()
        .filter(|item| item.session_id != "no-project")
        .all(|item| !item.cwd.is_empty()));
}
