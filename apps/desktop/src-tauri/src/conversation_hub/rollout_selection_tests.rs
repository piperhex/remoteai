use super::bin_test_support::{Fixture, STATE, THREAD};
use super::*;

fn point_to(source: &Fixture, path: &str) {
    Connection::open(source.home.join(STATE))
        .unwrap()
        .execute(
            "UPDATE threads SET rollout_path = ?1 WHERE id = ?2",
            params![path, THREAD],
        )
        .unwrap();
}

fn package(source: &Fixture) -> (PathBuf, PackageManifest) {
    let path = source.root.join("package.zip");
    let snapshots = selected_snapshots(&source.home, &HashSet::from([THREAD.to_owned()])).unwrap();
    transfer_package::write(&source.home, &snapshots, &path).unwrap();
    let manifest = read_package(&path).unwrap();
    (path, manifest)
}

#[test]
fn invalid_index_never_falls_back_or_replaces_an_existing_export() {
    let source = Fixture::new();
    transfer_tests::segments(&source);
    let destination = source.root.join("existing.zip");
    fs::write(&destination, b"previous export").unwrap();
    for indexed in [
        "sessions/rollout-missing.jsonl",
        "sessions/invalid.txt",
        "sessions/rollout-thread-b.jsonl",
        "",
    ] {
        point_to(&source, &source.home.join(indexed).to_string_lossy());
        let before = source.dump(THREAD);
        assert!(selected_snapshots(&source.home, &HashSet::from([THREAD.to_owned()])).is_err());
        let error =
            transfer_package::write(&source.home, &[source.snapshot()], &destination).unwrap_err();
        let display: Value = serde_json::from_str(&error).unwrap();
        assert_eq!(
            display["code"],
            "client.errorsConversations.sessionFailedVerification"
        );
        assert_eq!(display["params"]["value1"], THREAD);
        assert_eq!(fs::read(&destination).unwrap(), b"previous export");
        assert_eq!(source.dump(THREAD), before);
    }
}

#[test]
fn missing_index_rejects_multiple_segments_but_allows_one_with_a_compressed_shadow() {
    let source = Fixture::new();
    source.sql(
        STATE,
        "DELETE FROM thread_spawn_edges; DELETE FROM threads WHERE id = 'thread-a'",
    );
    source.rollout("sessions/rollout-thread-a.jsonl.zst", THREAD);
    let (path, manifest) = package(&source);
    assert_eq!(manifest.sessions[0].rollouts.len(), 2);
    let target = source.root.join("empty-home");
    assert_eq!(
        transfer_import::read(
            &target,
            &path,
            &manifest,
            &HashSet::from([THREAD.to_owned()])
        )
        .unwrap(),
        1
    );
    source.rollout("sessions/rollout-later.jsonl", THREAD);
    assert!(selected_snapshots(&source.home, &HashSet::from([THREAD.to_owned()])).is_err());
}

#[test]
fn importing_a_valid_old_segment_as_current_is_rejected_before_any_changes() {
    let source = Fixture::new();
    transfer_tests::segments(&source);
    let (path, mut manifest) = package(&source);
    let item = &mut manifest.sessions[0];
    let old = item
        .rollouts
        .iter()
        .find(|file| file.relative_rollout_path.starts_with("archived_sessions/"))
        .unwrap();
    item.relative_rollout_path = old.relative_rollout_path.clone();
    item.file_entry = old.file_entry.clone();
    item.sha256 = old.sha256.clone();
    let target = Fixture::new();
    target.discard();
    let before = target.dump(THREAD);
    assert!(transfer_import::read(
        &target.home,
        &path,
        &manifest,
        &HashSet::from([THREAD.to_owned()])
    )
    .is_err());
    assert_eq!(target.dump(THREAD), before);
    for file in &manifest.sessions[0].rollouts {
        assert!(!target.home.join(&file.relative_rollout_path).exists());
    }
    // Legacy single-file packages must not bypass the saved database pointer either.
    manifest.package_version = 1;
    manifest.sessions[0].rollouts.clear();
    assert!(transfer_package::validate(&manifest).is_err());
}

#[test]
fn multi_segment_import_requires_an_unambiguous_recorded_pointer() {
    let source = Fixture::new();
    transfer_tests::segments(&source);
    let (_, mut manifest) = package(&source);
    manifest.sessions[0].state_row = None;
    assert!(transfer_package::validate(&manifest).is_err());
}

#[test]
fn portable_pointer_validation_preserves_source_path_semantics() {
    for indexed in [
        r"\\?\C:\Users\test\.codex\sessions\rollout-current.jsonl",
        r"\\?\UNC\server\share\.codex\sessions\rollout-current.jsonl.zst",
        "c:/users/test/.codex/SESSIONS/rollout-current.jsonl",
        "/home/test/.codex/sessions/rollout-current.jsonl",
    ] {
        assert!(
            rollout_pointer::matches("sessions/rollout-current.jsonl.zst", indexed),
            "{indexed}"
        );
    }
    for indexed in [
        "/home/test/.codex/SESSIONS/rollout-current.jsonl",
        "/home/test/.codex/other-sessions/rollout-current.jsonl",
        "/home/test/.codex/archived_sessions/rollout-current.jsonl",
        "/home/test/.codex/sessions/rollout-old.jsonl",
    ] {
        assert!(
            !rollout_pointer::matches("sessions/rollout-current.jsonl", indexed),
            "{indexed}"
        );
    }
}

#[test]
fn removed_current_file_is_rejected_even_when_the_snapshot_still_contains_its_path() {
    let source = Fixture::new();
    let current = transfer_tests::segments(&source);
    let snapshot = source.snapshot();
    let row = snapshot_thread_row(Some(&source.home.join(STATE)), THREAD).unwrap();
    fs::remove_file(current).unwrap();
    assert!(rollout_selection::primary(&snapshot, row.as_ref()).is_err());
}
