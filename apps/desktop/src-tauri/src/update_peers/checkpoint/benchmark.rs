//! Local storage microbenchmark: no network, fixed payload, same hashing and JSON work in both cases.
use super::*;
use serde_json::json;

const BYTES: usize = 64 * 1024 * 1024;

#[test]
#[ignore = "manual local storage benchmark; run with --ignored --nocapture --test-threads=1"]
fn checkpoint_storage_benchmark() {
    let directory = std::env::var_os("CHECKPOINT_BENCH_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    for round in 0..4 {
        for batched in if round % 2 == 0 {
            [false, true]
        } else {
            [true, false]
        } {
            let root = tempfile::tempdir_in(&directory).unwrap();
            let payload = vec![37; BLOCK_BYTES];
            let start = Instant::now();
            let (syncs, ledger_syncs, replaces) = if batched {
                batched_run(root.path(), &payload)
            } else {
                baseline_run(root.path(), &payload)
            };
            let seconds = start.elapsed().as_secs_f64();
            println!(
                "{}",
                json!({
                    "mode": if batched { "batched" } else { "before" }, "round": round,
                    "bytes": BYTES, "seconds": seconds, "mib_per_second": 64.0 / seconds,
                    "data_syncs": syncs, "ledger_syncs": ledger_syncs, "ledger_replaces": replaces,
                    "storage_directory": directory, "network": "none; in-memory identical 512 KiB blocks"
                })
            );
        }
    }
}

fn batched_run(directory: &std::path::Path, payload: &[u8]) -> (usize, usize, usize) {
    let (mut files, _) = open(directory, BYTES);
    for index in 0..BYTES / BLOCK_BYTES {
        files.write(index, payload).unwrap();
    }
    files.flush().unwrap();
    (
        files.probe.data_syncs,
        files.probe.ledger_syncs,
        files.probe.replaces,
    )
}

fn baseline_run(directory: &std::path::Path, payload: &[u8]) -> (usize, usize, usize) {
    // Exact persistence order in checkpoint.rs at 04776426e; exclude async dispatch from BOTH runs.
    let mut file = fs::File::create(directory.join(format!("{ID}.partial"))).unwrap();
    file.set_len(BYTES as u64).unwrap();
    let blocks = BYTES / BLOCK_BYTES;
    #[derive(serde::Serialize)]
    struct LegacyLedger {
        size: usize,
        hashes: Vec<Option<String>>,
    }
    let mut ledger = LegacyLedger {
        size: BYTES,
        hashes: vec![None; blocks],
    };
    for index in 0..blocks {
        file.seek(SeekFrom::Start((index * BLOCK_BYTES) as u64))
            .unwrap();
        file.write_all(payload).unwrap();
        file.sync_data().unwrap();
        ledger.hashes[index] = Some(digest(payload));
        let data = serde_json::to_vec(&ledger).unwrap();
        let mut temporary = tempfile::NamedTempFile::new_in(directory).unwrap();
        temporary.write_all(&data).unwrap();
        temporary.as_file().sync_all().unwrap();
        temporary
            .persist(directory.join(format!("{ID}.json")))
            .unwrap();
    }
    (blocks, blocks, blocks)
}
