use super::super::super::bin_test_support::{Fixture, OTHER, THREAD};
use super::super::super::home_migration_provider::MigrationModelProvider;
use super::*;

const PHYSICAL: &str = "00000000-0000-4000-8000-000000000001";

fn source_with_history(include_base: bool, compressed: bool) -> (Fixture, Vec<BinSnapshot>) {
    let source = Fixture::new();
    let current = source.snapshot().path;
    fs::write(
        current,
        format!(
            "{}\n",
            json!({"type":"session_meta","payload":{
                "id":THREAD,"session_id":THREAD,"cwd":"/project",
                "history_base":{"thread_id":PHYSICAL}
            }})
        ),
    )
    .unwrap();
    if include_base {
        let directory = source.home.join("sessions/2026/11/09");
        fs::create_dir_all(&directory).unwrap();
        let name = format!("rollout-2026-11-09T00-00-00-{THREAD}_{PHYSICAL}.jsonl");
        let bytes = format!(
            "{}\n",
            json!({"type":"session_meta","payload":{
                "id":THREAD,"session_id":THREAD,"cwd":"/project"
            }})
        )
        .into_bytes();
        if compressed {
            fs::write(
                directory.join(format!("{name}.zst")),
                zstd::stream::encode_all(bytes.as_slice(), 1).unwrap(),
            )
            .unwrap();
        } else {
            fs::write(directory.join(name), bytes).unwrap();
        }
    }
    let package = source.root.join("physical-history-sync");
    fs::create_dir_all(&package).unwrap();
    archive::snapshot_source(&source.home, &package, vec![THREAD.into()]).unwrap();
    let snapshots = archive::snapshots(&package).unwrap();
    (source, snapshots)
}

#[test]
fn bundled_physical_history_is_accepted_even_with_logical_metadata_ids() {
    for compressed in [false, true] {
        let (_source, snapshots) = source_with_history(true, compressed);
        let target = Fixture::new();
        validate_history(&target.home, &snapshots).unwrap();
    }
}

#[test]
fn physical_history_already_at_destination_is_accepted() {
    for extension in ["jsonl", "jsonl.zst"] {
        let (_source, snapshots) = source_with_history(false, false);
        let target = Fixture::new();
        target.rollout(
            &format!("sessions/rollout-2026-11-09T00-00-00-{OTHER}_{PHYSICAL}.{extension}"),
            OTHER,
        );
        validate_history(&target.home, &snapshots).unwrap();
    }
}

#[test]
fn genuinely_missing_physical_history_is_still_rejected() {
    let (_source, snapshots) = source_with_history(false, false);
    let target = Fixture::new();
    assert!(validate_history(&target.home, &snapshots).is_err());
}

#[test]
fn invalid_or_unrelated_filenames_do_not_add_history_aliases() {
    assert!(physical_history_id(Path::new("unrelated.jsonl")).is_none());
    assert!(physical_history_id(Path::new("rollout-invalid.jsonl")).is_none());
    assert!(physical_history_id(Path::new(
        "other-00000000-0000-4000-8000-000000000001.jsonl"
    ))
    .is_none());
    assert!(physical_history_id(Path::new(
        "rollout-2026-11-09T00-00-00-thread-a_not-a-valid-uuid.jsonl.zst"
    ))
    .is_none());
    assert!(physical_history_id(Path::new("rollout-中文.jsonl")).is_none());
}

#[test]
fn physical_history_ids_are_parsed_from_plain_and_compressed_rollouts() {
    for extension in ["jsonl", "jsonl.zst"] {
        let bundled = format!("rollout-2026-11-09T00-00-00-{THREAD}_{PHYSICAL}.{extension}");
        assert_eq!(
            physical_history_id(Path::new(&bundled)).as_deref(),
            Some(PHYSICAL)
        );
        let legacy = format!("rollout-2026-11-09T00-00-00-{PHYSICAL}.{extension}");
        assert_eq!(
            physical_history_id(Path::new(&legacy)).as_deref(),
            Some(PHYSICAL)
        );
    }
}

fn planned_transfer(source: &Fixture, target: &Fixture, moving: bool) -> Transfer {
    let mut entry = Transfer {
        root: source.root.join("physical-history-sync"),
        size: 0,
        sha256: String::new(),
        written: 0,
        source: moving.then(|| source.home.clone()),
        plan: None,
        touched: Instant::now(),
        retain: false,
        original_size: 0,
        resume_token: String::new(),
    };
    let preview = preview_at_target(&target.home, &mut entry).unwrap();
    assert_eq!(preview["duplicateIds"], json!([THREAD]));
    entry
}

fn commit_overwrite(target: &Fixture, entry: &mut Transfer) -> Result<Value, String> {
    commit_at_target(
        &target.home,
        entry,
        vec![THREAD.into()],
        MigrationModelProvider::Gui,
    )
}

#[test]
fn overwrite_rejects_destination_only_history_before_changing_either_home() {
    for extension in ["jsonl", "jsonl.zst"] {
        for moving in [false, true] {
            let (source, _) = source_with_history(false, false);
            let target = Fixture::new();
            let base = target.rollout(
                &format!("sessions/rollout-2026-11-09T00-00-00-{THREAD}_{PHYSICAL}.{extension}"),
                THREAD,
            );
            let base_before = fs::read(&base).unwrap();
            let source_path = source.snapshot().path;
            let source_bytes = fs::read(&source_path).unwrap();
            let source_before = source.dump(THREAD);
            let target_before = target.dump(THREAD);
            let current = target.home.join(format!("sessions/rollout-{THREAD}.jsonl"));
            let current_before = fs::read(&current).unwrap();
            let mut entry = planned_transfer(&source, &target, moving);
            let transfer_root = entry.root.clone();
            assert_eq!(commit_overwrite(&target, &mut entry).unwrap_err(), INVALID);
            drop(entry);
            assert!(!transfer_root.exists());
            assert_eq!(fs::read(base).unwrap(), base_before);
            assert_eq!(fs::read(current).unwrap(), current_before);
            assert_eq!(source.dump(THREAD), source_before);
            assert_eq!(target.dump(THREAD), target_before);
            assert_eq!(fs::read(source_path).unwrap(), source_bytes);
        }
    }
}

#[test]
fn bundled_physical_history_survives_committed_overwrite_and_transfer_cleanup() {
    for compressed in [false, true] {
        for moving in [false, true] {
            let (source, _) = source_with_history(true, compressed);
            let target = Fixture::new();
            let extension = if compressed { "jsonl.zst" } else { "jsonl" };
            let old_base = target.rollout(
                &format!("sessions/rollout-2026-11-09T00-00-00-{THREAD}_{PHYSICAL}.{extension}"),
                THREAD,
            );
            let mut entry = planned_transfer(&source, &target, moving);
            let result = commit_overwrite(&target, &mut entry).unwrap();
            assert_eq!(result, json!({"completedCount": 1, "skippedCount": 0}));
            let base = gather_snapshots(&target.home)
                .unwrap()
                .into_iter()
                .flat_map(|item| item.physical_paths)
                .find(|path| physical_history_id(path).as_deref() == Some(PHYSICAL))
                .unwrap();
            let snapshots = archive::snapshots(&entry.root).unwrap();
            validate_history(&target.home, &snapshots).unwrap();
            let transfer_root = entry.root.clone();
            drop(entry);
            assert!(!transfer_root.exists());
            assert!(!old_base.exists());
            assert!(base.exists());
            assert_eq!(
                source
                    .home
                    .join(format!("sessions/rollout-{THREAD}.jsonl"))
                    .exists(),
                !moving
            );
        }
    }
}

#[test]
fn untouched_destination_history_survives_committed_sync_and_transfer_cleanup() {
    for extension in ["jsonl", "jsonl.zst"] {
        for moving in [false, true] {
            let (source, _) = source_with_history(false, false);
            let target = Fixture::new();
            let base = target.rollout(
                &format!("sessions/rollout-2026-11-09T00-00-00-{OTHER}_{PHYSICAL}.{extension}"),
                OTHER,
            );
            let base_before = fs::read(&base).unwrap();
            let untouched_before = target.dump(OTHER);
            let mut entry = planned_transfer(&source, &target, moving);
            let result = commit_overwrite(&target, &mut entry).unwrap();
            assert_eq!(result, json!({"completedCount": 1, "skippedCount": 0}));
            let snapshots = archive::snapshots(&entry.root).unwrap();
            validate_history(&target.home, &snapshots).unwrap();
            let transfer_root = entry.root.clone();
            drop(entry);
            assert!(!transfer_root.exists());
            assert_eq!(fs::read(base).unwrap(), base_before);
            assert_eq!(target.dump(OTHER), untouched_before);
            assert_eq!(
                source
                    .home
                    .join(format!("sessions/rollout-{THREAD}.jsonl"))
                    .exists(),
                !moving
            );
        }
    }
}
