use super::{bulk::BlockRead, file::StreamFile, manifest::BLOCK_BYTES, StreamKind};
use crate::codex_gui::error::GuiError;
use std::{fs, path::PathBuf, sync::atomic::Ordering};

struct Source(PathBuf);
impl Source {
    fn new(bytes: &[u8]) -> Self {
        let root = std::env::temp_dir().join(format!("remote-ai-bulk-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("data.bin"), bytes).unwrap();
        Self(root)
    }
    fn open(&self) -> StreamFile {
        StreamFile::open(&self.0, "data.bin", u64::MAX, StreamKind::Download).unwrap()
    }
}
impl Drop for Source {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn request(id: String, block: usize) -> BlockRead {
    BlockRead {
        thread_id: "task".into(),
        id: "handle".into(),
        manifest_id: id,
        block,
        max_bytes: u64::MAX,
    }
}

#[test]
fn content_identity_ignores_mtime_and_covers_empty_and_partial_blocks() {
    for bytes in [vec![], vec![17; BLOCK_BYTES + 3]] {
        let source = Source::new(&bytes);
        let mut file = source.open();
        let manifest = file.manifest(u64::MAX).unwrap();
        let id = manifest.info.manifest_id.clone();
        if bytes.is_empty() {
            assert!(manifest.page(0).is_err());
            assert!(file.bulk_read(&request(id, 0)).is_err());
        } else {
            assert_eq!(
                file.bulk_read(&request(id.clone(), 0)).unwrap(),
                &bytes[..BLOCK_BYTES]
            );
            assert_eq!(
                file.bulk_read(&request(id, 1)).unwrap(),
                &bytes[BLOCK_BYTES..]
            );
        }
    }
}

#[test]
fn detects_content_mutation_even_when_size_and_mtime_are_preserved() {
    let source = Source::new(&[1, 2, 3]);
    let mut file = source.open();
    let id = file.manifest(u64::MAX).unwrap().info.manifest_id.clone();
    let path = source.0.join("data.bin");
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    fs::write(&path, [4, 5, 6]).unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    assert!(matches!(
        file.bulk_read(&request(id.clone(), 0)),
        Err(GuiError::FileChanged)
    ));
    assert_ne!(
        source.open().manifest(u64::MAX).unwrap().info.manifest_id,
        id
    );
}

#[test]
fn rejects_wrong_content_identity_out_of_range_and_cancelled_scans() {
    let source = Source::new(&[9; 123]);
    let mut file = source.open();
    file.cancelled.store(true, Ordering::Relaxed);
    assert!(matches!(
        file.manifest(u64::MAX),
        Err(GuiError::FileExpired)
    ));
    let mut file = source.open();
    let id = file.manifest(u64::MAX).unwrap().info.manifest_id.clone();
    assert!(file.bulk_read(&request("0".repeat(64), 0)).is_err());
    assert!(file.bulk_read(&request(id, 1)).is_err());
}
