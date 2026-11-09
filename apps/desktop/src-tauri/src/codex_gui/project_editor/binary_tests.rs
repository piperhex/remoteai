use super::*;

const REPORTED_PDF_BYTES: usize = 4_731_358;

#[test]
fn binary_files_above_the_inline_threshold_remain_available_to_previews() {
    let root = tempfile::tempdir().unwrap();
    for name in ["report.pdf", "recording.mp4", "archive.bin", "invalid.txt"] {
        for size in [INLINE_BYTES, INLINE_BYTES + 1, REPORTED_PDF_BYTES] {
            let mut bytes = vec![b'x'; size];
            bytes[..8].copy_from_slice(b"%PDF-1.7");
            bytes[PAGE_BYTES - 1] = 0;
            fs::write(root.path().join(name), &bytes).unwrap();
            let token = uuid::Uuid::new_v4().to_string();
            let request: Target = serde_json::from_value(serde_json::json!({
                "cwd": execution_path(root.path()), "path": name,
                "window": { "token": token, "open": true },
            }))
            .unwrap();
            let doc = read(request).unwrap().data;
            assert_eq!(doc["kind"], "binary", "{name}: {size}");
            assert_eq!(doc["size"], size as u64);
            assert_eq!(doc["revision"], revision(&bytes));
            assert_eq!(doc["readOnly"], true);
            assert_eq!(doc["chunked"], false);
            assert!(doc["text"].is_null());
            assert!(doc["image"].is_null());
            assert!(doc["window"].is_null());
            assert!(!views().lock().unwrap().contains_key(&token));
        }
    }
}

#[test]
fn pdfs_with_only_utf8_bytes_also_bypass_text_paging() {
    let root = tempfile::tempdir().unwrap();
    for name in ["report.pdf", "report.PDF"] {
        for size in [INLINE_BYTES, INLINE_BYTES + 1] {
            fs::write(root.path().join(name), vec![b' '; size]).unwrap();
            let request = serde_json::json!({ "cwd": execution_path(root.path()), "path": name,
                "window": { "token": uuid::Uuid::new_v4(), "open": true } });
            let doc = read(serde_json::from_value(request).unwrap()).unwrap().data;
            assert_eq!(doc["kind"], "binary");
            assert_eq!(doc["readOnly"], true);
            assert_eq!(doc["chunked"], false);
            assert!(doc["text"].is_null());
            assert!(doc["window"].is_null());
        }
    }
}

#[test]
fn binary_files_do_not_leave_an_editable_window() {
    let root = tempfile::tempdir().unwrap();
    let bytes = vec![0; INLINE_BYTES + 1];
    let path = root.path().join("report.pdf");
    fs::write(&path, &bytes).unwrap();
    let token = uuid::Uuid::new_v4().to_string();
    let request = serde_json::json!({ "cwd": execution_path(root.path()), "path": "report.pdf",
        "window": { "token": token, "open": true } });
    let doc = read(serde_json::from_value(request.clone()).unwrap())
        .unwrap()
        .data;
    let mut write = request;
    write["window"] = serde_json::json!({ "token": token, "offset": 0, "end": PAGE_BYTES });
    write["revision"] = doc["revision"].clone();
    write["text"] = "replacement".into();
    assert!(matches!(
        save(serde_json::from_value(write).unwrap()),
        Err(GuiError::FileExpired)
    ));
    assert_eq!(fs::read(path).unwrap(), bytes);
}
