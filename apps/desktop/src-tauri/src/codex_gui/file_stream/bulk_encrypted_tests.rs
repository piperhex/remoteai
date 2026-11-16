use super::{
    bulk::BlockRead,
    bulk_encrypted::{OpenSender, ReadBatch},
    file::StreamFile,
    StreamKind,
};
use crate::codex_gui::error::GuiError;
use std::{fs, sync::atomic::Ordering};
use uuid::Uuid;

#[test]
fn native_sender_rechecks_source_scopes_cancellation_and_never_restarts_an_epoch() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("source.bin");
    fs::write(&path, vec![7; 2 * 1024 * 1024]).unwrap();
    let mut file = StreamFile::open(
        directory.path(),
        "source.bin",
        u64::MAX,
        StreamKind::Download,
    )
    .unwrap();
    let manifest = file.manifest(u64::MAX).unwrap().info.manifest_id.clone();
    let open = OpenSender {
        thread_id: Uuid::new_v4().to_string(),
        id: file.info().id,
        manifest_id: manifest.clone(),
        epoch: Uuid::new_v4(),
        key: [7; 32],
        record_bytes: 16384,
        max_bytes: u64::MAX,
    };
    file.open_sender(&open).unwrap();
    assert!(matches!(
        file.open_sender(&open),
        Err(GuiError::FileExpired)
    ));
    let mut read = ReadBatch {
        source: BlockRead {
            thread_id: open.thread_id.clone(),
            id: open.id.clone(),
            manifest_id: manifest,
            block: 0,
            max_bytes: u64::MAX,
        },
        epoch: open.epoch,
        request_id: Uuid::new_v4(),
        offset: 0,
    };
    assert!(!file.sender_batch(&read).unwrap().is_empty());
    file.cancelled.store(true, Ordering::Relaxed);
    read.offset = 16 * (16384 - 88);
    assert!(matches!(
        file.sender_batch(&read),
        Err(GuiError::FileExpired)
    ));
    file.cancelled.store(false, Ordering::Relaxed);
    fs::write(&path, vec![8; 2 * 1024 * 1024]).unwrap();
    read.source.block = 1;
    read.offset = 0;
    read.request_id = Uuid::new_v4();
    assert!(matches!(
        file.sender_batch(&read),
        Err(GuiError::FileChanged)
    ));
}
