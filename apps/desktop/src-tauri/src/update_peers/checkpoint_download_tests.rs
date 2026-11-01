use super::*;
use crate::update_peers::{
    block_download,
    snapshot::{digest, BLOCK_BYTES},
};
use std::{fs, io::Write};

fn seed_legacy_checkpoint(service: &Service, artifact: &Artifact, bytes: &[u8]) {
    let directory = service.cache.partial_directory();
    fs::create_dir_all(&directory).unwrap();
    let mut file = fs::File::create(directory.join(format!("{}.partial", artifact.id))).unwrap();
    file.set_len(bytes.len() as u64).unwrap();
    file.write_all(&bytes[..BLOCK_BYTES]).unwrap();
    file.sync_all().unwrap();
    let mut hashes = vec![None; bytes.len().div_ceil(BLOCK_BYTES)];
    hashes[0] = Some(digest(&bytes[..BLOCK_BYTES]));
    fs::write(
        directory.join(format!("{}.json", artifact.id)),
        serde_json::to_vec(&serde_json::json!({"size": bytes.len(), "hashes": hashes})).unwrap(),
    )
    .unwrap();
}

#[tokio::test]
async fn signed_http_resume_downloads_only_missing_ranges() {
    let bytes = vec![19; BLOCK_BYTES * 3 + 7];
    let origin = Origin::with_bytes(bytes.clone());
    let update = origin.update().await;
    let directory = tempfile::tempdir().unwrap();
    let service = service(directory.path(), &origin.key);
    let artifact = Artifact::from_update(&update);
    seed_legacy_checkpoint(&service, &artifact, &bytes);
    let received = packages::download_recorded(
        &service,
        &artifact,
        |_, _| {},
        &mut crate::update_peers::reporting::Report::new(&artifact.id),
    )
    .await
    .unwrap();
    assert_eq!(received.as_slice(), bytes);
    assert_eq!(
        service.policy.metrics.origin_bytes.load(Ordering::Relaxed),
        (bytes.len() - BLOCK_BYTES) as u64
    );
    assert!(!service.cache.has_partial(&artifact.id).await);
}

#[tokio::test]
async fn checkpoint_hashes_cannot_bypass_final_upstream_signature() {
    let bytes = vec![19; BLOCK_BYTES * 2 + 7];
    let origin = Origin::with_bytes(bytes.clone());
    let update = origin.update().await;
    let directory = tempfile::tempdir().unwrap();
    let service = service(directory.path(), &origin.key);
    let artifact = Artifact::from_update(&update);
    let mut poisoned = bytes.clone();
    poisoned[0] ^= 1;
    seed_legacy_checkpoint(&service, &artifact, &poisoned);
    let result = packages::download_recorded(
        &service,
        &artifact,
        |_, _| {},
        &mut crate::update_peers::reporting::Report::new(&artifact.id),
    )
    .await;
    assert!(matches!(result, Err(Error::Invalid)));
    assert!(!service.cache.has_partial(&artifact.id).await);
    let received = block_download::download(&mut Vec::new(), &artifact, &service, |_, _| {})
        .await
        .unwrap();
    artifact.verify(&received, &origin.key).unwrap();
    assert_eq!(received, bytes);
}
