use super::super::super::bin_test_support::{Fixture, THREAD};
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
            &format!("sessions/rollout-2026-11-09T00-00-00-{THREAD}_{PHYSICAL}.{extension}"),
            THREAD,
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
