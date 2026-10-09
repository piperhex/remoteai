use super::*;
use std::sync::mpsc;
use tauri::ipc::InvokeResponseBody;

fn frame(session: &str) -> Vec<u8> {
    let mut bytes = b"CSF1".to_vec();
    bytes.push(session.len() as u8);
    bytes.extend_from_slice(session.as_bytes());
    let mut record = vec![7; 16 * 1024];
    record[..8].copy_from_slice(b"RAB1\x01\x01\x00\x48");
    record[64..68].copy_from_slice(&(16_384u32 - 88).to_be_bytes());
    bytes.extend(record);
    bytes
}

fn receiver() -> (ClientBulk, mpsc::Receiver<Vec<u8>>) {
    let (sender, receiver) = mpsc::channel();
    let channel = Channel::new(move |body| {
        let InvokeResponseBody::Raw(bytes) = body else {
            panic!("file bytes must stay binary")
        };
        sender.send(bytes).unwrap();
        Ok(())
    });
    (ClientBulk::new(Some(channel)), receiver)
}

#[test]
fn rejects_unnegotiated_wrong_session_and_malformed_records() {
    let (mut bulk, output) = receiver();
    assert!(bulk.enqueue(frame("session"), Some("session")).is_err());
    bulk.negotiate(true);
    assert!(bulk.enqueue(frame("other"), Some("session")).is_err());
    assert!(bulk.enqueue(frame("session"), None).is_err());
    let mut malformed = frame("session");
    malformed.pop();
    assert!(bulk.enqueue(malformed, Some("session")).is_err());
    bulk.negotiate(false);
    assert!(bulk.enqueue(frame("session"), Some("session")).is_err());
    assert_eq!(bulk.buffered, 0);
    assert!(output.try_recv().is_err());
    let mut legacy = ClientBulk::new(None);
    legacy.negotiate(true);
    assert!(legacy.enqueue(frame("session"), Some("session")).is_err());
}

#[test]
fn raw_batches_preserve_records_and_require_the_matching_acknowledgement() {
    let (mut bulk, output) = receiver();
    bulk.negotiate(true);
    let record = frame("session");
    for _ in 0..20 {
        bulk.enqueue(record.clone(), Some("session")).unwrap();
    }
    bulk.flush().unwrap();
    let bytes = output.recv().unwrap();
    assert_eq!(&bytes[..9], b"CGR1\0\0\0\x01\x10");
    assert_eq!(bytes.len(), BATCH_HEADER_BYTES + 16 * (4 + record.len()));
    for encoded in bytes[9..].chunks_exact(4 + record.len()) {
        assert_eq!(&encoded[..4], &(record.len() as u32).to_be_bytes());
        assert_eq!(&encoded[4..], record);
    }
    bulk.acknowledge(2);
    bulk.flush().unwrap();
    assert!(output.try_recv().is_err());
    assert_eq!(bulk.buffered, 20 * record.len());
    bulk.acknowledge(1);
    bulk.acknowledge(1);
    assert_eq!(bulk.buffered, 4 * record.len());
    bulk.flush().unwrap();
    assert_eq!(&output.recv().unwrap()[..9], b"CGR1\0\0\0\x02\x04");
    bulk.acknowledge(1);
    assert_ne!(bulk.pending, 0);
    bulk.acknowledge(2);
    assert_eq!(bulk.buffered, 0);
}

#[test]
fn a_paused_renderer_bounds_memory_and_resumes_without_dropping_bytes() {
    let (mut bulk, output) = receiver();
    bulk.negotiate(true);
    let mut records = 0;
    while bulk.has_capacity() {
        bulk.enqueue(frame("session"), Some("session")).unwrap();
        bulk.flush().unwrap();
        records += 1;
    }
    assert!(bulk.buffered <= MAX_BUFFER_BYTES);
    let mut received = 0;
    while bulk.buffered > 0 {
        let bytes = output.recv().unwrap();
        received += usize::from(bytes[8]);
        bulk.acknowledge(u32::from_be_bytes(bytes[4..8].try_into().unwrap()).into());
        bulk.flush().unwrap();
    }
    assert_eq!(received, records);
    assert!(bulk.has_capacity());
}
