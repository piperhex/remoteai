use super::*;
use std::io::Write;

#[test]
fn pdf_metadata_reports_exact_size_without_the_text_or_memory_preview_cap() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("paper.PDF");
    let file = File::create(&path).unwrap();
    let size = 80 * 1024 * 1024;
    file.set_len(size).unwrap();
    let data = load(&path).unwrap().unwrap();
    assert_eq!(data.size, Some(size));
    assert_eq!(data.kind, PreviewKind::Pdf);
    assert!(data.text.is_none());
}

#[test]
fn json_preview_reads_ten_megabytes_and_reports_the_original_byte_size() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("models.JSON");
    let bytes = format!("{{\"padding\":\"{}\"}}", "a".repeat(10 * 1024 * 1024));
    std::fs::write(&path, &bytes).unwrap();
    let data = load(&path).unwrap().unwrap();
    assert_eq!(data.text.as_deref(), Some(bytes.as_str()));
    assert_eq!(data.size, Some(bytes.len() as u64));
    assert_eq!(data.kind, PreviewKind::Text);
}

#[test]
fn json_reader_honors_its_bound_and_keeps_other_text_limits() {
    let directory = tempfile::tempdir().unwrap();
    for (name, limit) in [("models.json", MAX_JSON_BYTES), ("code.ts", MAX_TEXT_BYTES)] {
        let path = directory.path().join(name);
        let mut file = File::create(&path).unwrap();
        file.write_all(b"{}").unwrap();
        file.set_len(limit + 1).unwrap();
        assert!(load(&path).unwrap().is_none());
    }
}

#[test]
fn utf16_json_size_includes_bom_and_original_encoding() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("encoded.json");
    let text = "{\"name\":\"中文\"}";
    let mut bytes = vec![0xff, 0xfe];
    bytes.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
    std::fs::write(&path, &bytes).unwrap();
    let data = load(&path).unwrap().unwrap();
    assert_eq!(data.size, Some(bytes.len() as u64));
    assert_eq!(data.text.as_deref(), Some(text));
}
