use super::*;

#[test]
fn validates_split_sequences_and_rejects_truncated_utf8_without_retaining_a_file() {
    let mut file = tempfile::tempfile().unwrap();
    let text = format!("{}🙂中\r\n", "a".repeat(BUFFER_BYTES - 1));
    file.write_all(text.as_bytes()).unwrap();
    use std::io::{Seek, SeekFrom};
    file.seek(SeekFrom::Start(0)).unwrap();
    let result = scan(&mut file, None, 8, None).unwrap();
    assert!(result.text && result.inline.is_empty());
    assert_eq!(result.revision, super::revision(text.as_bytes()));
    file.write_all(&[0xf0, 0x9f]).unwrap();
    file.seek(SeekFrom::Start(0)).unwrap();
    assert!(!scan(&mut file, None, 0, None).unwrap().text);
}

#[test]
fn a_disk_full_output_error_stops_capture_without_changing_the_source() {
    struct Full;
    impl Write for Full {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::new(
                std::io::ErrorKind::StorageFull,
                "injected disk full",
            ))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut source = tempfile::tempfile().unwrap();
    source.write_all(&vec![b'a'; BUFFER_BYTES * 2]).unwrap();
    use std::io::{Seek, SeekFrom};
    source.seek(SeekFrom::Start(0)).unwrap();
    assert!(matches!(
        scan(&mut source, Some(&mut Full), 0, None),
        Err(GuiError::ProjectFileWrite)
    ));
    assert_eq!(source.metadata().unwrap().len(), (BUFFER_BYTES * 2) as u64);
}

#[test]
fn a_growing_log_finishes_at_its_initial_length_and_reports_the_change() {
    struct Append(File);
    impl Write for Append {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.write_all(bytes)?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.0.flush()
        }
    }
    let source = tempfile::NamedTempFile::new().unwrap();
    fs::write(source.path(), vec![b'a'; BUFFER_BYTES * 2]).unwrap();
    let before = fs::metadata(source.path()).unwrap();
    let mut reading = File::open(source.path()).unwrap();
    let mut appending = Append(
        fs::OpenOptions::new()
            .append(true)
            .open(source.path())
            .unwrap(),
    );
    let scan = scan(&mut reading, Some(&mut appending), 0, None).unwrap();
    assert_eq!(scan.size, before.len());
    assert_eq!(fs::metadata(source.path()).unwrap().len(), before.len() * 2);
    assert!(matches!(
        unchanged(source.path(), &before),
        Err(GuiError::ProjectFileConflict)
    ));
}
