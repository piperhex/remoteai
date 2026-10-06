use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};

fn snapshot(streams: &FileStreams, bytes: &[u8]) -> serde_json::Value {
    streams
        .insert_preview(
            "transfer".into(),
            bytes,
            "preview.txt".into(),
            "text/plain".into(),
        )
        .unwrap()
        .data
}

#[test]
fn preview_snapshots_resume_with_stable_content_revisions_and_transfer_ownership() {
    let streams = FileStreams::downloads();
    let bytes = "预览内容\n第二行".as_bytes();
    let first = snapshot(&streams, bytes);
    let second = snapshot(&streams, bytes);
    assert_ne!(first["id"], second["id"]);
    assert_eq!(first["revision"], second["revision"]);
    assert_ne!(
        first["revision"],
        snapshot(&streams, b"changed")["revision"]
    );
    let id = first["id"].as_str().unwrap().to_string();
    let request = |thread_id: &str| StreamRead {
        thread_id: thread_id.into(),
        id: id.clone(),
        offset: 0,
        length: CHUNK_BYTES,
        max_bytes: 1024,
    };
    assert!(streams.read_chunk(request("other-transfer")).is_err());
    let content = streams.read_chunk(request("transfer")).unwrap();
    assert_eq!(STANDARD.decode(content.data).unwrap(), bytes);
    streams
        .remove(StreamClose {
            thread_id: "transfer".into(),
            id: id.clone(),
        })
        .unwrap();
    assert!(streams.read_chunk(request("transfer")).is_err());
}

#[test]
fn preview_snapshots_support_the_same_authenticated_manifest_and_binary_blocks() {
    let streams = FileStreams::downloads();
    let bytes = vec![7; 300_000];
    let info = snapshot(&streams, &bytes);
    let file = streams
        .authorized_file(info["id"].as_str().unwrap(), "transfer")
        .unwrap();
    let mut file = file.lock().unwrap();
    let manifest = file.manifest(1_000_000).unwrap();
    assert_eq!(manifest.info.size, bytes.len() as u64);
    assert!(file.manifest(10).is_err());
}
