//! Explicit release-only, single-ended measurements of the actual file sender implementation.
use super::{
    bulk::BlockRead,
    bulk_cipher::{Batch, Sender},
    bulk_encrypted::{OpenSender, ReadBatch},
    file::StreamFile,
    manifest::BLOCK_BYTES,
    StreamKind,
};
use std::{fs::File, hint::black_box, io::Write, path::Path, time::Instant};
use uuid::Uuid;

const BLOCKS: usize = 512;
const TOTAL_BYTES: u64 = (BLOCKS * BLOCK_BYTES) as u64;
const RECORD_BYTES: usize = 16 * 1024;
const PAYLOAD_BYTES: usize = RECORD_BYTES - 88;
const BATCH_PAYLOAD: usize = 16 * PAYLOAD_BYTES;

fn source(root: &Path) -> Vec<u8> {
    let bytes: Vec<u8> = (0..BLOCK_BYTES).map(|index| (index % 251) as u8).collect();
    let mut file = File::create(root.join("throughput.bin")).unwrap();
    for _ in 0..BLOCKS {
        file.write_all(&bytes).unwrap();
    }
    file.sync_all().unwrap();
    bytes
}

fn prepare(root: &Path) -> (StreamFile, OpenSender) {
    let mut file =
        StreamFile::open(root, "throughput.bin", TOTAL_BYTES, StreamKind::Download).unwrap();
    let manifest_id = file.manifest(TOTAL_BYTES).unwrap().info.manifest_id.clone();
    let options = OpenSender {
        thread_id: Uuid::new_v4().to_string(),
        id: file.info().id,
        manifest_id,
        epoch: Uuid::new_v4(),
        key: [7; 32],
        record_bytes: RECORD_BYTES,
        max_bytes: TOTAL_BYTES,
    };
    (file, options)
}

fn read(options: &OpenSender, block: usize) -> BlockRead {
    BlockRead {
        thread_id: options.thread_id.clone(),
        id: options.id.clone(),
        manifest_id: options.manifest_id.clone(),
        block,
        max_bytes: TOTAL_BYTES,
    }
}

fn useful_bytes(batch: &[u8]) -> usize {
    assert_eq!(&batch[..4], b"RAN1");
    let count = batch[4] as usize;
    assert!((1..=16).contains(&count));
    batch.len() - 5 - count * (4 + 88)
}

fn sample(root: &Path, plain: &[u8], mode: &str) -> serde_json::Value {
    let prepared = Instant::now();
    let (mut file, options) = prepare(root);
    file.open_sender(&options).unwrap();
    let prepare_ms = prepared.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    let bytes = transfer(&mut file, &options, plain, mode);
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(bytes as u64, TOTAL_BYTES);
    serde_json::json!({"stage":mode,"ms":ms,"MiBps":bytes as f64 / 1048576.0 / (ms / 1000.0),
        "prepareMs":prepare_ms,"accountedBytes":bytes})
}

fn transfer(file: &mut StreamFile, options: &OpenSender, plain: &[u8], mode: &str) -> usize {
    let mut memory = Sender::new(options).unwrap();
    let mut bytes = 0usize;
    for block in 0..BLOCKS {
        if mode == "read-sha256" {
            let data = file.bulk_read(&read(options, block)).unwrap();
            bytes += data.len();
            black_box(data);
            continue;
        }
        let request = Uuid::new_v4();
        for offset in (0..BLOCK_BYTES).step_by(BATCH_PAYLOAD) {
            let output = if mode == "encrypt-memory" {
                memory
                    .batch(
                        Batch {
                            epoch: options.epoch,
                            manifest: &options.manifest_id,
                            request,
                            block,
                            offset,
                        },
                        || Ok(plain.to_vec()),
                    )
                    .unwrap()
            } else {
                file.sender_batch(&ReadBatch {
                    source: read(options, block),
                    epoch: options.epoch,
                    request_id: request,
                    offset,
                })
                .unwrap()
            };
            bytes += useful_bytes(&output);
            black_box(output);
        }
    }
    bytes
}

#[test]
#[ignore = "Manual throughput benchmark; use --release --ignored --nocapture without concurrent work"]
fn single_ended_sender_throughput() {
    assert!(
        !black_box(cfg!(debug_assertions)),
        "Use the optimized release profile"
    );
    let directory = tempfile::tempdir().unwrap();
    let plain = source(directory.path());
    for mode in ["read-sha256", "encrypt-memory", "read-sha256-encrypt"] {
        sample(directory.path(), &plain, mode);
        for run in 1..=3 {
            let mut result = sample(directory.path(), &plain, mode);
            result["run"] = run.into();
            println!("P2P_STAGE_BENCHMARK {result}");
        }
    }
}
