use super::state::{Files, CHECKPOINT_BYTES, CHECKPOINT_INTERVAL};
use super::*;
use crate::update_peers::snapshot::{digest, BLOCK_BYTES};
use std::{
    fs,
    io::{Seek, SeekFrom, Write},
    time::{Duration, Instant},
};
const ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn open(root: &std::path::Path, size: usize) -> (Files, Vec<bool>) {
    Files::open(root.into(), ID.into(), size).unwrap()
}

fn ledger(root: &std::path::Path) -> serde_json::Value {
    serde_json::from_slice(&fs::read(root.join(format!("{ID}.json"))).unwrap()).unwrap()
}

fn stop(checkpoint: Arc<Checkpoint>) {
    let control = checkpoint.control.clone();
    drop(checkpoint);
    control.join();
}

#[test]
fn uncommitted_tail_is_not_restored_and_duplicates_do_not_overwrite() {
    let root = tempfile::tempdir().unwrap();
    let (mut files, _) = open(root.path(), BLOCK_BYTES * 3);
    files.write(2, &vec![3; BLOCK_BYTES]).unwrap();
    files.flush().unwrap();
    files.write(0, &vec![1; BLOCK_BYTES]).unwrap();
    files.write(2, &vec![9; BLOCK_BYTES]).unwrap();
    drop(files); // No graceful flush: model an interrupted process.
    let (mut files, done) = open(root.path(), BLOCK_BYTES * 3);
    assert_eq!(done, [false, false, true]);
    files.write(0, &vec![1; BLOCK_BYTES]).unwrap();
    files.write(1, &vec![2; BLOCK_BYTES]).unwrap();
    let bytes = files.finish(BLOCK_BYTES * 3).unwrap();
    assert_eq!(bytes[BLOCK_BYTES * 2], 3);
    assert!(!root.path().join(format!("{ID}.json")).exists());
}

#[test]
fn byte_threshold_and_finish_commit_only_complete_ranges() {
    let root = tempfile::tempdir().unwrap();
    let count = CHECKPOINT_BYTES / BLOCK_BYTES;
    let (mut files, _) = open(root.path(), CHECKPOINT_BYTES + 3);
    for index in 0..count {
        files.write(index, &vec![index as u8; BLOCK_BYTES]).unwrap();
    }
    assert_eq!(files.probe.data_syncs, 1);
    assert_eq!(files.probe.ledger_syncs, 1);
    assert_eq!(files.probe.replaces, 1);
    assert!(files.finish(CHECKPOINT_BYTES + 3).is_err());
    files.write(count, &[1, 2, 3]).unwrap();
    assert!(files.finish(3).is_err());
    let bytes = files.finish(CHECKPOINT_BYTES + 3).unwrap();
    assert_eq!(&bytes[CHECKPOINT_BYTES..], &[1, 2, 3]);
    assert_eq!(files.probe.replaces, 2);
}

#[test]
fn interruption_never_publishes_a_ledger_before_data_sync() {
    for stage in [
        "data_write",
        "after_data_write",
        "data_sync",
        "after_data_sync",
        "ledger_write",
        "ledger_sync",
        "replace",
        "after_replace",
    ] {
        let root = tempfile::tempdir().unwrap();
        let (mut files, _) = open(root.path(), BLOCK_BYTES * 2);
        files.write(0, &vec![1; BLOCK_BYTES]).unwrap();
        files.flush().unwrap();
        files.probe.interrupt = Some(stage);
        let result = files
            .write(1, &vec![2; BLOCK_BYTES])
            .and_then(|()| files.flush());
        assert!(result.is_err(), "{stage}");
        if ["data_write", "after_data_write", "data_sync"].contains(&stage) {
            assert_eq!(files.probe.data_syncs, 1, "{stage}");
            assert_eq!(files.probe.ledger_syncs, 1, "{stage}");
        }
        if stage != "after_replace" {
            assert_eq!(files.probe.replaces, 1, "{stage}");
        }
        drop(files);
        let (_, done) = open(root.path(), BLOCK_BYTES * 2);
        assert_eq!(done, [true, stage == "after_replace"], "{stage}");
    }
}

#[test]
fn truncated_corrupt_and_wrong_size_ledgers_are_discarded() {
    for corrupt in [b"{".as_slice(), br#"{"size":2,"hashes":[]}"#, b"null"] {
        let root = tempfile::tempdir().unwrap();
        let (mut files, _) = open(root.path(), 3);
        files.write(0, &[1, 2, 3]).unwrap();
        files.flush().unwrap();
        drop(files);
        fs::write(root.path().join(format!("{ID}.json")), corrupt).unwrap();
        let (_, done) = open(root.path(), 3);
        assert_eq!(done, [false]);
    }
}

#[test]
fn data_truncation_and_same_length_corruption_are_rechecked() {
    let root = tempfile::tempdir().unwrap();
    let (mut files, _) = open(root.path(), BLOCK_BYTES + 3);
    files.write(0, &vec![7; BLOCK_BYTES]).unwrap();
    files.write(1, &[1, 2, 3]).unwrap();
    files.flush().unwrap();
    drop(files);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .open(root.path().join(format!("{ID}.partial")))
        .unwrap();
    file.write_all(&[0]).unwrap();
    let (files, done) = open(root.path(), BLOCK_BYTES + 3);
    assert_eq!(done, [false, true]);
    drop(files);
    file.set_len(1).unwrap();
    let (_, done) = open(root.path(), BLOCK_BYTES + 3);
    assert_eq!(done, [false, false]);
}

#[tokio::test]
async fn idle_timer_commits_without_another_block() {
    let root = tempfile::tempdir().unwrap();
    let (checkpoint, _) = Checkpoint::open(root.path().into(), ID.into(), BLOCK_BYTES + 3)
        .await
        .unwrap();
    checkpoint.write(0, vec![7; BLOCK_BYTES]).await.unwrap();
    assert!(!root.path().join(format!("{ID}.json")).exists());
    let start = Instant::now();
    while !root.path().join(format!("{ID}.json")).exists() {
        assert!(start.elapsed() < CHECKPOINT_INTERVAL + Duration::from_secs(3));
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(start.elapsed() >= CHECKPOINT_INTERVAL - Duration::from_millis(200));
    assert!(ledger(root.path())["hashes"][0].is_string());
    stop(checkpoint);
}

#[tokio::test]
async fn cancellation_and_explicit_pause_flush_the_tail() {
    let root = tempfile::tempdir().unwrap();
    let (checkpoint, _) = Checkpoint::open(root.path().into(), ID.into(), BLOCK_BYTES + 3)
        .await
        .unwrap();
    checkpoint.write(0, vec![7; BLOCK_BYTES]).await.unwrap();
    checkpoint.flush().await.unwrap();
    let control = checkpoint.control.clone();
    let (ready, written) = oneshot::channel();
    let task = tokio::spawn(async move {
        checkpoint.write(1, vec![1, 2, 3]).await.unwrap();
        ready.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    tokio::time::timeout(Duration::from_secs(5), written)
        .await
        .unwrap()
        .unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    control.join();
    let (mut files, done) = open(root.path(), BLOCK_BYTES + 3);
    assert_eq!(done, [true, true]);
    assert_eq!(
        files.finish(BLOCK_BYTES + 3).unwrap().len(),
        BLOCK_BYTES + 3
    );
}

#[tokio::test]
async fn error_boundary_flushes_prior_accepted_blocks() {
    let root = tempfile::tempdir().unwrap();
    let (checkpoint, _) = Checkpoint::open(root.path().into(), ID.into(), BLOCK_BYTES + 3)
        .await
        .unwrap();
    checkpoint.write(0, vec![7; BLOCK_BYTES]).await.unwrap();
    assert!(checkpoint.write(1, vec![1]).await.is_err());
    stop(checkpoint);
    let (_, done) = open(root.path(), BLOCK_BYTES + 3);
    assert_eq!(done, [true, false]);
}

#[tokio::test]
async fn concurrent_sources_finish_with_exact_content() {
    let root = tempfile::tempdir().unwrap();
    let blocks = 17;
    let (checkpoint, _) = Checkpoint::open(root.path().into(), ID.into(), blocks * BLOCK_BYTES)
        .await
        .unwrap();
    let mut jobs = Vec::new();
    for index in (0..blocks).rev() {
        let destination = checkpoint.clone();
        jobs.push(tokio::spawn(async move {
            destination
                .write(index, vec![index as u8; BLOCK_BYTES])
                .await
                .unwrap();
        }));
    }
    for job in jobs {
        job.await.unwrap();
    }
    let bytes = checkpoint.finish(blocks * BLOCK_BYTES).await.unwrap();
    for (index, block) in bytes.chunks(BLOCK_BYTES).enumerate() {
        assert!(block.iter().all(|byte| *byte == index as u8));
    }
}

#[test]
fn active_checkpoint_cannot_be_opened_twice() {
    let root = tempfile::tempdir().unwrap();
    let (files, _) = open(root.path(), 3);
    assert!(Files::open(root.path().into(), ID.into(), 3).is_err());
    drop(files);
    open(root.path(), 3);
}

#[test]
fn orphaned_temporary_ledger_and_partial_data_write_are_not_trusted() {
    let root = tempfile::tempdir().unwrap();
    let (mut files, _) = open(root.path(), BLOCK_BYTES * 2);
    files.write(0, &vec![1; BLOCK_BYTES]).unwrap();
    files.flush().unwrap();
    drop(files);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .open(root.path().join(format!("{ID}.partial")))
        .unwrap();
    file.seek(SeekFrom::Start(BLOCK_BYTES as u64)).unwrap();
    file.write_all(&[9; 137]).unwrap();
    fs::write(root.path().join(".orphaned-ledger"), b"{\"size\":").unwrap();
    let (_, done) = open(root.path(), BLOCK_BYTES * 2);
    assert_eq!(done, [true, false]);
}

#[test]
fn resumed_out_of_order_blocks_still_require_whole_package_digest() {
    let root = tempfile::tempdir().unwrap();
    let expected = [vec![1; BLOCK_BYTES], vec![2; BLOCK_BYTES], vec![3; 7]].concat();
    let (mut files, _) = open(root.path(), expected.len());
    files.write(2, &[3; 7]).unwrap();
    files.flush().unwrap();
    drop(files);
    let (mut files, done) = open(root.path(), expected.len());
    assert_eq!(done, [false, false, true]);
    files.write(1, &vec![9; BLOCK_BYTES]).unwrap(); // A source with a self-consistent but incorrect digest.
    files.write(0, &vec![1; BLOCK_BYTES]).unwrap();
    let bytes = files.finish(expected.len()).unwrap();
    assert_ne!(digest(&bytes), digest(&expected));
    assert!(!root.path().join(format!("{ID}.json")).exists());
}

#[test]
fn process_exit_and_graceful_shutdown() {
    for mode in ["crash", "shutdown"] {
        let root = tempfile::tempdir().unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "update_peers::checkpoint::tests::exit_child",
                "--nocapture",
            ])
            .env("CHECKPOINT_EXIT_CHILD", mode)
            .env("CHECKPOINT_EXIT_ROOT", root.path())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(if mode == "crash" { 91 } else { 0 }));
        let (_, done) = open(root.path(), BLOCK_BYTES * 2);
        assert_eq!(done, [true, mode == "shutdown"]);
    }
}

#[test]
fn exit_child() {
    let Ok(mode) = std::env::var("CHECKPOINT_EXIT_CHILD") else {
        return;
    };
    let root = PathBuf::from(std::env::var_os("CHECKPOINT_EXIT_ROOT").unwrap());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let (checkpoint, _) = Checkpoint::open(root.clone(), ID.into(), BLOCK_BYTES * 2)
            .await
            .unwrap();
        checkpoint.write(0, vec![1; BLOCK_BYTES]).await.unwrap();
        checkpoint.flush().await.unwrap();
        checkpoint.write(1, vec![2; BLOCK_BYTES]).await.unwrap();
        if mode == "crash" {
            std::process::exit(91);
        }
        shutdown();
        assert!(checkpoint.write(1, vec![2; BLOCK_BYTES]).await.is_err());
        assert!(Checkpoint::open(root, "b".repeat(64), 3).await.is_err());
    });
}

#[path = "benchmark.rs"]
mod benchmark;
