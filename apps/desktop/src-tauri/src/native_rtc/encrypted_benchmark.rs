//! Diagnostic: production file reads/encryption -> SCTP -> Android production decoder/hash/storage.
use super::{benchmark::event, channel::Channel, peer::Peer};
use crate::codex_gui::file_stream::encrypted_benchmark_source::{self as fixture, Source};
use bytes::Bytes;
use serde_json::{json, Value};
use std::time::Instant;

pub(super) async fn samples(peer: &Peer, channel: &Channel, config: &Value) -> Vec<Value> {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().to_owned();
    tokio::task::spawn_blocking(move || fixture::source(&path))
        .await
        .unwrap();
    let mut samples = Vec::new();
    for run in 0..config["runs"].as_u64().unwrap() as u32 {
        let path = directory.path().to_owned();
        let mut source = tokio::task::spawn_blocking(move || Source::new(&path, run))
            .await
            .unwrap();
        channel
            .send(Bytes::from(source.metadata.to_string()), true)
            .await
            .unwrap();
        assert_eq!(event(peer, false).await["ready"], run);
        let started = Instant::now();
        let mut worker_ms = 0.0;
        for block in 0..fixture::BLOCKS {
            let request = uuid::Uuid::new_v4();
            for offset in (0..1024 * 1024).step_by(fixture::BATCH_PAYLOAD) {
                let worker = Instant::now();
                let (next, batch) = tokio::task::spawn_blocking(move || {
                    let batch = source.batch(block, request, offset);
                    (source, batch)
                })
                .await
                .unwrap();
                worker_ms += worker.elapsed().as_secs_f64() * 1000.0;
                source = next;
                for record in super::bulk::records(batch.into()).unwrap() {
                    channel.send(record, false).await.unwrap();
                }
            }
        }
        let result = event(peer, false).await;
        assert_eq!(result["run"], run);
        assert_eq!(result["verified"], true);
        samples.push(
            json!({"run":run,"ms":started.elapsed().as_secs_f64()*1000.0,
            "workerMs":worker_ms,"receiver":result}),
        );
    }
    samples
}
