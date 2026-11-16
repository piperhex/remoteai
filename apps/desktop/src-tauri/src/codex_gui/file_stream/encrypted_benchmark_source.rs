//! Test-only adapter around the production authorized file reader and RAB1 sender.
use super::{
    bulk::BlockRead,
    bulk_encrypted::{OpenSender, ReadBatch},
    file::StreamFile,
    StreamKind,
};
use rand::RngCore;
use serde_json::{json, Value};
use std::{fs::File, io::Write, path::Path};
use uuid::Uuid;

pub(crate) const BLOCKS: usize = 128;
const BLOCK_BYTES: usize = 1024 * 1024;
const SIZE: u64 = (BLOCKS * BLOCK_BYTES) as u64;
pub(crate) const BATCH_PAYLOAD: usize = 16 * (16384 - 88);

pub(crate) fn source(root: &Path) {
    let mut output = File::create(root.join("encrypted-benchmark.bin")).unwrap();
    let mut bytes = vec![0; BLOCK_BYTES];
    let mut rng = rand::rng();
    for _ in 0..BLOCKS {
        rng.fill_bytes(&mut bytes);
        output.write_all(&bytes).unwrap();
    }
    output.sync_all().unwrap();
}

pub(crate) struct Source {
    file: StreamFile,
    options: OpenSender,
    pub metadata: Value,
}

impl Source {
    pub(crate) fn new(root: &Path, run: u32) -> Self {
        let mut file =
            StreamFile::open(root, "encrypted-benchmark.bin", SIZE, StreamKind::Download).unwrap();
        let manifest = file.manifest(SIZE).unwrap();
        let info = serde_json::to_value(&manifest.info).unwrap();
        let page = serde_json::to_value(manifest.page(0).unwrap()).unwrap();
        let options = OpenSender {
            thread_id: Uuid::new_v4().to_string(),
            id: file.info().id,
            manifest_id: info["manifestId"].as_str().unwrap().into(),
            epoch: Uuid::new_v4(),
            key: [7; 32],
            record_bytes: 16384,
            max_bytes: SIZE,
        };
        let metadata = json!({"manifest":info,"page":page,"transfer":options.thread_id,
            "epoch":options.epoch,"key":"07".repeat(32),"run":run});
        file.open_sender(&options).unwrap();
        Self {
            file,
            options,
            metadata,
        }
    }

    pub(crate) fn batch(&mut self, block: usize, request: Uuid, offset: usize) -> Vec<u8> {
        self.file
            .sender_batch(&ReadBatch {
                source: BlockRead {
                    thread_id: self.options.thread_id.clone(),
                    id: self.options.id.clone(),
                    manifest_id: self.options.manifest_id.clone(),
                    block,
                    max_bytes: SIZE,
                },
                epoch: self.options.epoch,
                request_id: request,
                offset,
            })
            .unwrap()
    }
}
