use super::bin_test_support::{Fixture, HISTORY, OTHER, STATE, THREAD};
use super::*;

pub(super) fn point_to(fixture: &Fixture, path: &Path) {
    // Canonicalizing the parent retains Windows' extended prefix even for a compressed
    // rollout whose logical .jsonl no longer exists.
    let indexed = fs::canonicalize(path.parent().unwrap())
        .unwrap()
        .join(path.file_name().unwrap());
    Connection::open(fixture.home.join(STATE))
        .unwrap()
        .execute(
            "UPDATE threads SET rollout_path = ?1 WHERE id = ?2",
            params![indexed.to_string_lossy(), THREAD],
        )
        .unwrap();
}

pub(super) fn segments(fixture: &Fixture) -> PathBuf {
    fixture.sql(STATE, "DELETE FROM thread_spawn_edges");
    fixture.rollout("archived_sessions/rollout-old.jsonl.zst", THREAD);
    let current = fixture.rollout("sessions/rollout-z-current.jsonl", THREAD);
    let mut file = File::options().append(true).open(&current).unwrap();
    writeln!(
        file,
        "{}",
        json!({"type":"event_msg","payload":{
        "type":"user_message","message":"Newest message must survive export"}})
    )
    .unwrap();
    point_to(fixture, &current);
    current
}

fn export(fixture: &Fixture) -> (PathBuf, PackageManifest) {
    let snapshots = selected_snapshots(&fixture.home, &HashSet::from([THREAD.to_owned()])).unwrap();
    let path = fixture.root.join("package.zip");
    transfer_package::write(&fixture.home, &snapshots, &path).unwrap();
    let manifest = read_package(&path).unwrap();
    (path, manifest)
}

fn import(target: &Fixture, path: &Path, manifest: &PackageManifest) -> Result<usize, String> {
    transfer_import::read(
        &target.home,
        path,
        manifest,
        &HashSet::from([THREAD.to_owned()]),
    )
}

#[test]
fn local_package_round_trips_every_segment_and_the_current_pointer() {
    let source = Fixture::new();
    let current = segments(&source);
    let before = source.dump(THREAD);
    let snapshots = selected_snapshots(&source.home, &HashSet::from([THREAD.to_owned()])).unwrap();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].path, current);
    assert_eq!(snapshots[0].physical_paths.len(), 3);
    let (path, manifest) = export(&source);
    assert_eq!(manifest.package_version, 2);
    let item = &manifest.sessions[0];
    assert_eq!(item.rollouts.len(), 3);
    assert_eq!(item.size_bytes, snapshots[0].size_bytes);
    assert_eq!(
        item.relative_rollout_path,
        "sessions/rollout-z-current.jsonl"
    );
    let target = Fixture::new();
    target.discard();
    let unrelated = target.dump(OTHER);
    assert_eq!(import(&target, &path, &manifest).unwrap(), 1);
    for file in &item.rollouts {
        assert_eq!(
            fs::read(source.home.join(&file.relative_rollout_path)).unwrap(),
            fs::read(target.home.join(&file.relative_rollout_path)).unwrap()
        );
    }
    assert_eq!(
        PathBuf::from(target.visibility().rollout_path),
        target.home.join("sessions/rollout-z-current.jsonl")
    );
    assert!(
        locate_rollout_text(&target.home.join(&item.relative_rollout_path), "Newest")
            .unwrap()
            .is_some()
    );
    assert_eq!(target.dump(OTHER), unrelated);
    assert_eq!(source.dump(THREAD), before);
    assert_eq!(import(&target, &path, &manifest).unwrap(), 0);
}

#[test]
fn compressed_current_and_uncompressed_shadow_keep_their_original_bytes() {
    let source = Fixture::new();
    segments(&source);
    let current = source.rollout("sessions/rollout-z-current.jsonl.zst", THREAD);
    fs::remove_file(current.with_extension("")).unwrap();
    point_to(&source, &current.with_extension(""));
    let shadow = source.rollout("sessions/rollout-thread-a.jsonl.zst", THREAD);
    let (path, manifest) = export(&source);
    assert_eq!(manifest.sessions[0].rollouts.len(), 4);
    assert_eq!(
        manifest.sessions[0].relative_rollout_path,
        "sessions/rollout-z-current.jsonl.zst"
    );
    let target = Fixture::new();
    target.discard();
    assert_eq!(import(&target, &path, &manifest).unwrap(), 1);
    assert_eq!(
        PathBuf::from(target.visibility().rollout_path),
        target.home.join("sessions/rollout-z-current.jsonl")
    );
    assert_eq!(
        fs::read(shadow).unwrap(),
        fs::read(target.home.join("sessions/rollout-thread-a.jsonl.zst")).unwrap()
    );
    assert!(
        first_rollout_value(&target.home.join("sessions/rollout-z-current.jsonl.zst"))
            .unwrap()
            .is_some()
    );
}

#[test]
fn single_file_version_one_packages_remain_importable() {
    let source = Fixture::new();
    let (_, mut manifest) = export(&source);
    manifest.package_version = 1;
    let item = &mut manifest.sessions[0];
    item.rollouts.clear();
    // Old exporters counted compressed shadows in sizeBytes even though they saved one file.
    item.size_bytes += 100;
    let path = source.root.join("version-one.zip");
    let mut archive = ZipWriter::new(File::create(&path).unwrap());
    archive
        .start_file(&item.file_entry, SimpleFileOptions::default())
        .unwrap();
    archive
        .write_all(&fs::read(source.home.join(&item.relative_rollout_path)).unwrap())
        .unwrap();
    let mut json = serde_json::to_value(&manifest).unwrap();
    json["sessions"][0]
        .as_object_mut()
        .unwrap()
        .remove("rollouts");
    archive
        .start_file("manifest.json", SimpleFileOptions::default())
        .unwrap();
    serde_json::to_writer(&mut archive, &json).unwrap();
    archive.finish().unwrap();
    let manifest = read_package(&path).unwrap();
    let empty_home = source.root.join("empty-home");
    assert_eq!(
        transfer_import::read(
            &empty_home,
            &path,
            &manifest,
            &HashSet::from([THREAD.to_owned()])
        )
        .unwrap(),
        1
    );
    assert_eq!(
        fs::read(empty_home.join(&manifest.sessions[0].relative_rollout_path)).unwrap(),
        fs::read(source.snapshot().path).unwrap()
    );
    let target = Fixture::new();
    target.discard();
    assert_eq!(import(&target, &path, &manifest).unwrap(), 1);
    assert_eq!(
        fs::read(source.snapshot().path).unwrap(),
        fs::read(target.snapshot().path).unwrap()
    );
}

#[test]
fn a_corrupt_later_segment_leaves_no_partial_files_or_state() {
    let source = Fixture::new();
    segments(&source);
    let (path, mut manifest) = export(&source);
    manifest.sessions[0].rollouts[1].sha256 = "0".repeat(64);
    let target = Fixture::new();
    target.discard();
    let before = target.dump(THREAD);
    assert!(import(&target, &path, &manifest).is_err());
    assert_eq!(target.dump(THREAD), before);
    assert!(gather_snapshots(&target.home)
        .unwrap()
        .iter()
        .all(|item| item.session_id != THREAD));
}

#[test]
fn importing_extra_segments_never_overwrites_another_threads_file() {
    let source = Fixture::new();
    segments(&source);
    let (path, manifest) = export(&source);
    let target = Fixture::new();
    target.discard();
    let collision = target.rollout("sessions/rollout-z-current.jsonl", OTHER);
    let original = fs::read(&collision).unwrap();
    let unrelated = target.dump(OTHER);
    assert!(import(&target, &path, &manifest).is_err());
    assert_eq!(fs::read(&collision).unwrap(), original);
    assert_eq!(target.dump(OTHER), unrelated);
    assert!(!target
        .home
        .join("archived_sessions/rollout-old.jsonl.zst")
        .exists());
    assert!(snapshot_thread_row(Some(&target.home.join(STATE)), THREAD)
        .unwrap()
        .is_none());
}

#[test]
fn state_restore_failure_rolls_back_all_imported_segments() {
    let source = Fixture::new();
    segments(&source);
    let (path, manifest) = export(&source);
    let target = Fixture::new();
    target.discard();
    target.sql(
        HISTORY,
        "CREATE TRIGGER reject_import BEFORE INSERT ON thread_items
        BEGIN SELECT RAISE(ABORT, 'forced import failure'); END",
    );
    let before = target.dump(THREAD);
    assert!(import(&target, &path, &manifest).is_err());
    assert_eq!(target.dump(THREAD), before);
    for file in &manifest.sessions[0].rollouts {
        assert!(!target.home.join(&file.relative_rollout_path).exists());
    }
    assert!(!index_values(&target.home).unwrap().contains_key(THREAD));
}

#[test]
fn package_validation_rejects_missing_current_files_and_unsafe_extra_paths() {
    let source = Fixture::new();
    segments(&source);
    let (_, manifest) = export(&source);
    let mut missing = manifest.clone();
    missing.sessions[0].rollouts.clear();
    assert!(transfer_package::validate(&missing).is_err());
    let mut traversal = manifest.clone();
    traversal.sessions[0].rollouts[1].relative_rollout_path = "../auth.json".into();
    assert!(transfer_package::validate(&traversal).is_err());
    let mut duplicate = manifest.clone();
    duplicate.sessions[0].rollouts[1] = duplicate.sessions[0].rollouts[0].clone();
    assert!(transfer_package::validate(&duplicate).is_err());
    let mut wrong_current = manifest;
    wrong_current.sessions[0].relative_rollout_path = "sessions/rollout-absent.jsonl".into();
    assert!(transfer_package::validate(&wrong_current).is_err());
}

#[test]
fn dependencies_in_later_segments_cannot_be_dropped_by_deduplication() {
    let source = Fixture::new();
    let path = segments(&source);
    fs::write(
        path,
        json!({"type":"session_meta","payload":{
        "id":THREAD, "history_base":OTHER}})
        .to_string(),
    )
    .unwrap();
    assert!(selected_snapshots(&source.home, &HashSet::from([THREAD.to_owned()])).is_err());
    assert_eq!(
        selected_snapshots(
            &source.home,
            &HashSet::from([THREAD.to_owned(), OTHER.to_owned()])
        )
        .unwrap()
        .len(),
        2
    );
}

#[test]
fn normal_paths_also_select_the_database_current_record() {
    let source = Fixture::new();
    let current = segments(&source);
    Connection::open(source.home.join(STATE))
        .unwrap()
        .execute(
            "UPDATE threads SET rollout_path = ?1 WHERE id = ?2",
            params![current.to_string_lossy(), THREAD],
        )
        .unwrap();
    let manifest = bin_manifest_for_snapshot(&source.home, source.snapshot()).unwrap();
    assert_eq!(manifest.original_rollout_path, current);
}
