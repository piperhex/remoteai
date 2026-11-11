use super::super::bin_test_support::{Fixture, STATE, THREAD};
use super::*;

fn prepared(source: &Fixture) -> PathBuf {
    let root = source.root.join("sync-pointers");
    fs::create_dir_all(&root).unwrap();
    archive::snapshot_source(&source.home, &root, vec![THREAD.into()]).unwrap();
    root
}

#[test]
fn synchronization_rejects_a_stale_source_pointer_without_changing_the_source() {
    let source = Fixture::new();
    super::super::transfer_tests::segments(&source);
    source.sql(
        STATE,
        "UPDATE threads SET rollout_path = 'sessions/rollout-missing.jsonl' WHERE id = 'thread-a'",
    );
    let before = source.dump(THREAD);
    let root = source.root.join("rejected-sync");
    fs::create_dir_all(&root).unwrap();
    assert!(archive::snapshot_source(&source.home, &root, vec![THREAD.into()]).is_err());
    assert_eq!(source.dump(THREAD), before);
    assert!(!root.join("manifest.json").exists());
    assert_eq!(source.snapshot().physical_paths.len(), 3);
}

#[test]
fn synchronization_rejects_an_old_current_pointer_even_if_that_file_is_present() {
    let source = Fixture::new();
    super::super::transfer_tests::segments(&source);
    let root = prepared(&source);
    let mut manifests: Vec<BinManifest> =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    manifests[0].relative_rollout_path = "archived_sessions/rollout-old.jsonl.zst".into();
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&manifests).unwrap(),
    )
    .unwrap();
    assert!(archive::snapshots(&root).is_err());
    // Changing both manifest pointers must still disagree with the saved database row.
    manifests[0].original_rollout_path = source.home.join(&manifests[0].relative_rollout_path);
    fs::write(
        root.join("manifest.json"),
        serde_json::to_vec(&manifests).unwrap(),
    )
    .unwrap();
    assert!(archive::snapshots(&root).is_err());
}

#[test]
fn synchronization_rejects_a_missing_current_file_before_restoring_history() {
    let source = Fixture::new();
    let current = super::super::transfer_tests::segments(&source);
    let root = prepared(&source);
    let relative = current.strip_prefix(&source.home).unwrap();
    fs::remove_file(
        root.join("sessions")
            .join(THREAD)
            .join("files")
            .join(relative),
    )
    .unwrap();
    assert!(archive::snapshots(&root).is_err());
}
