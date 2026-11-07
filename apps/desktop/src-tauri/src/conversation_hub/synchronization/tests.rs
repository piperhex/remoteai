use super::super::bin_test_support::{Fixture, HISTORY, OTHER, STATE, THREAD};
use super::super::home_migration_batch::synchronize_batch;
use super::super::home_migration_provider::{MigrationDestination, MigrationModelProvider};
use super::*;

fn source() -> Fixture {
    let fixture = Fixture::new();
    fixture.sql(STATE, "DELETE FROM thread_spawn_edges");
    fixture
}

fn prepared(source: &Fixture) -> PathBuf {
    let root = source.root.join("sync");
    fs::create_dir_all(&root).unwrap();
    archive::snapshot_source(&source.home, &root, vec![THREAD.into()]).unwrap();
    root
}

fn synchronize(source: &Fixture, target: &Fixture, moving: bool) -> Result<(), String> {
    let root = prepared(source);
    synchronize_batch(
        moving.then_some(source.home.as_path()),
        MigrationDestination {
            path: &target.home,
            model_provider: Some(MigrationModelProvider::Gui),
        },
        &root,
        archive::snapshots(&root).unwrap(),
    )
    .map_err(|error| error.diagnostic())
}

#[test]
fn remote_copy_keeps_source_and_replaces_only_the_confirmed_target() {
    let source = source();
    let target = self::source();
    target.sql(
        STATE,
        "UPDATE threads SET title = 'Old destination' WHERE id = 'thread-a'",
    );
    let source_before = source.dump(THREAD);
    let unrelated = target.dump(OTHER);
    let original = fs::read(source.snapshot().path).unwrap();
    synchronize(&source, &target, false).unwrap();
    assert_eq!(source.dump(THREAD), source_before);
    assert_eq!(fs::read(source.snapshot().path).unwrap(), original);
    assert_eq!(target.dump(OTHER), unrelated);
    let row = snapshot_thread_row(Some(&target.home.join(STATE)), THREAD)
        .unwrap()
        .unwrap();
    assert_eq!(
        sqlite_row_text(&row, "model_provider"),
        Some("codex-switch-gui")
    );
    assert_ne!(sqlite_row_text(&row, "title"), Some("Old destination"));
}

#[test]
fn local_sync_moves_the_source_after_target_commit() {
    let source = source();
    let target = self::source();
    target.discard();
    synchronize(&source, &target, true).unwrap();
    source.assert_removed();
    assert!(target.snapshot().path.exists());
}

#[test]
fn failed_overwrite_restores_target_history_and_source() {
    let source = source();
    let target = self::source();
    target.sql(
        HISTORY,
        "UPDATE thread_items SET note = 'Previous target' WHERE thread_id = 'thread-a'",
    );
    target.sql(
        HISTORY,
        "CREATE TRIGGER reject_sync BEFORE INSERT ON thread_items
        WHEN NEW.note = '历史内容' BEGIN SELECT RAISE(ABORT, 'forced sync failure'); END",
    );
    let source_before = source.dump(THREAD);
    let target_before = target.dump(THREAD);
    let bytes = fs::read(target.snapshot().path).unwrap();
    assert!(synchronize(&source, &target, false).is_err());
    assert_eq!(source.dump(THREAD), source_before);
    assert_eq!(target.dump(THREAD), target_before);
    assert_eq!(fs::read(target.snapshot().path).unwrap(), bytes);
}

#[test]
fn packaged_remote_history_round_trips_and_rejects_tampering() {
    let source = source();
    source.rollout("archived_sessions/rollout-archive.jsonl.zst", THREAD);
    let root = prepared(&source);
    archive::pack(&root).unwrap();
    let path = root.join("bundle.zip");
    let incoming = source.root.join("incoming");
    fs::create_dir_all(&incoming).unwrap();
    fs::copy(&path, incoming.join("bundle.zip")).unwrap();
    let size = fs::metadata(&path).unwrap().len();
    let entry = Transfer {
        root: incoming,
        size,
        sha256: sha256(&path).unwrap(),
        written: size,
        source: None,
        plan: None,
        touched: Instant::now(),
        retain: false,
    };
    archive::unpack(&entry).unwrap();
    let snapshots = archive::snapshots(&entry.root).unwrap();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].rollouts.len(), 2);
    for path in &snapshots[0].rollouts {
        assert_eq!(
            first_rollout_value(path)
                .unwrap()
                .as_ref()
                .and_then(snapshot_id),
            Some(THREAD.to_owned())
        );
    }
    fs::write(entry.root.join("bundle.zip"), "tampered").unwrap();
    assert_eq!(archive::unpack(&entry).unwrap_err(), INVALID);
}

#[test]
fn chunks_allow_identical_retries_but_reject_changed_or_out_of_order_data() {
    let source = source();
    let root = source.root.join("chunks");
    fs::create_dir_all(&root).unwrap();
    File::create(root.join("bundle.zip")).unwrap();
    let mut entry = Transfer {
        root,
        size: 6,
        sha256: String::new(),
        written: 0,
        source: None,
        plan: None,
        touched: Instant::now(),
        retain: false,
    };
    assert!(write(&mut entry, 3, &STANDARD.encode(b"def")).is_err());
    write(&mut entry, 0, &STANDARD.encode(b"abc")).unwrap();
    write(&mut entry, 0, &STANDARD.encode(b"abc")).unwrap();
    assert!(write(&mut entry, 0, &STANDARD.encode(b"xyz")).is_err());
    write(&mut entry, 3, &STANDARD.encode(b"def")).unwrap();
    assert_eq!(fs::read(entry.root.join("bundle.zip")).unwrap(), b"abcdef");
}

fn planned_transfer(source: &Fixture, moving: bool) -> Transfer {
    Transfer {
        root: prepared(source),
        source: moving.then(|| source.home.clone()),
        size: 0,
        sha256: String::new(),
        written: 0,
        plan: None,
        touched: Instant::now(),
        retain: false,
    }
}

#[test]
fn duplicates_are_reported_and_skipped_until_explicitly_approved() {
    let source = source();
    let target = self::source();
    let before = target.dump(THREAD);
    let mut entry = planned_transfer(&source, false);
    let preview = planning::preview_at_target(&target.home, &mut entry).unwrap();
    assert_eq!(preview["duplicateIds"], json!([THREAD]));
    let result = planning::commit_at_target(
        &target.home,
        &mut entry,
        vec![],
        MigrationModelProvider::Gui,
    )
    .unwrap();
    assert_eq!(result["completedCount"], 0);
    assert_eq!(result["skippedCount"], 1);
    assert_eq!(target.dump(THREAD), before);
    assert!(source.snapshot().path.exists());
}

#[test]
fn changed_destination_requires_another_confirmation_without_overwriting_new_content() {
    let source = source();
    let target = self::source();
    let mut entry = planned_transfer(&source, false);
    planning::preview_at_target(&target.home, &mut entry).unwrap();
    target.sql(
        STATE,
        "UPDATE threads SET title = 'New target content' WHERE id = 'thread-a'",
    );
    let changed = target.dump(THREAD);
    let error = planning::commit_at_target(
        &target.home,
        &mut entry,
        vec![THREAD.into()],
        MigrationModelProvider::Gui,
    )
    .unwrap_err();
    assert_eq!(error, CHANGED);
    assert_eq!(target.dump(THREAD), changed);
    assert!(source.snapshot().path.exists());
}

#[test]
fn confirmed_local_overwrite_moves_once_and_commit_retries_are_idempotent() {
    let source = source();
    let target = self::source();
    let mut entry = planned_transfer(&source, true);
    planning::preview_at_target(&target.home, &mut entry).unwrap();
    let result = planning::commit_at_target(
        &target.home,
        &mut entry,
        vec![THREAD.into()],
        MigrationModelProvider::Gui,
    )
    .unwrap();
    source.assert_removed();
    let committed = target.dump(THREAD);
    assert_eq!(
        planning::commit_at_target(
            &target.home,
            &mut entry,
            vec![THREAD.into()],
            MigrationModelProvider::Gui
        )
        .unwrap(),
        result
    );
    assert_eq!(target.dump(THREAD), committed);
}

#[test]
fn remote_duplicates_can_be_skipped_before_any_payload_is_received() {
    let source = source();
    let target = self::source();
    let root = source.root.join("metadata-only");
    fs::create_dir_all(&root).unwrap();
    File::create(root.join("bundle.zip")).unwrap();
    let mut entry = Transfer {
        root,
        size: 1000,
        sha256: "a".repeat(64),
        written: 0,
        source: None,
        plan: None,
        touched: Instant::now(),
        retain: false,
    };
    let before = target.dump(THREAD);
    let ids = HashSet::from([THREAD.to_owned()]);
    let preview = planning::preview_ids(&target.home, &mut entry, ids).unwrap();
    assert_eq!(preview["duplicateIds"], json!([THREAD]));
    let result = planning::commit_at_target(
        &target.home,
        &mut entry,
        vec![],
        MigrationModelProvider::Gui,
    )
    .unwrap();
    assert_eq!(result["completedCount"], 0);
    assert_eq!(result["skippedCount"], 1);
    assert_eq!(target.dump(THREAD), before);
    assert!(!entry.root.join("manifest.json").exists());
}

#[test]
fn archive_identity_must_match_the_conversations_confirmed_before_transfer() {
    let source = source();
    let target = self::source();
    let mut entry = planned_transfer(&source, false);
    let before = target.dump(OTHER);
    planning::preview_ids(&target.home, &mut entry, HashSet::from([OTHER.to_owned()])).unwrap();
    let error = planning::commit_at_target(
        &target.home,
        &mut entry,
        vec![OTHER.into()],
        MigrationModelProvider::Gui,
    )
    .unwrap_err();
    assert_eq!(error, INVALID);
    assert_eq!(target.dump(OTHER), before);
    assert!(source.snapshot().path.exists());
}
