use super::*;
use crate::codex_gui::file_stream::bulk_encrypted::OpenSender;
use chacha20poly1305::aead::{Aead, Payload};

fn options() -> OpenSender {
    OpenSender {
        thread_id: Uuid::from_bytes([0x11; 16]).to_string(),
        id: "handle".into(),
        manifest_id: "a".repeat(64),
        epoch: Uuid::from_bytes([0x22; 16]),
        key: std::array::from_fn(|i| i as u8),
        record_bytes: MAX_RECORD_BYTES,
        max_bytes: u64::MAX,
    }
}

fn request(block: usize, offset: usize) -> Batch<'static> {
    Batch {
        epoch: Uuid::from_bytes([0x22; 16]),
        manifest: concat!(
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        ),
        request: Uuid::from_bytes([0x33 + block as u8; 16]),
        block,
        offset,
    }
}

fn records(wire: &[u8]) -> Vec<&[u8]> {
    assert_eq!(&wire[..4], b"RAN1");
    let mut offset = 5;
    let mut result = Vec::new();
    for _ in 0..wire[4] {
        let length = u32::from_be_bytes(wire[offset..offset + 4].try_into().unwrap()) as usize;
        offset += 4;
        result.push(&wire[offset..offset + length]);
        offset += length;
    }
    assert_eq!(offset, wire.len());
    result
}

#[test]
fn matches_the_existing_javascript_rab1_cipher_vector_byte_for_byte() {
    let mut sender = Sender::new(&options()).unwrap();
    let mut batch = request(7, 0);
    batch.request = Uuid::from_bytes([0x33; 16]);
    let wire = sender.batch(batch, || Ok(vec![7, 8, 9])).unwrap();
    let actual: String = records(&wire)[0]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(actual, concat!(
        "52414231010100481111111111111111111111111111111122222222222222222222222222222222",
        "33333333333333333333333333333333000000070000000000000003000000016e547571d47726b549765781debfa7b3159274"));
}

#[test]
fn interleaved_blocks_have_one_monotonic_sequence_and_exact_authenticated_plaintext() {
    let settings = options();
    let mut sender = Sender::new(&settings).unwrap();
    let cipher = ChaCha20Poly1305::new((&settings.key).into());
    let length = 1024 * 1024;
    let mut offsets = [0usize; 2];
    let mut sequence = 0;
    while offsets.iter().any(|offset| *offset < length) {
        for (block, offset) in offsets.iter_mut().enumerate() {
            if *offset == length {
                continue;
            }
            let first = *offset == 0;
            let wire = sender
                .batch(request(block, *offset), || {
                    assert!(first, "verified block was reread");
                    Ok(vec![block as u8; length])
                })
                .unwrap();
            assert!(records(&wire).len() <= BATCH_RECORDS);
            for record in records(&wire) {
                sequence += 1;
                assert_eq!(
                    u32::from_be_bytes(record[68..72].try_into().unwrap()),
                    sequence
                );
                assert_eq!(
                    u32::from_be_bytes(record[60..64].try_into().unwrap()) as usize,
                    *offset
                );
                let mut nonce = [0; 12];
                nonce[8..].copy_from_slice(&sequence.to_be_bytes());
                let plain = cipher
                    .decrypt(
                        Nonce::from_slice(&nonce),
                        Payload {
                            msg: &record[HEADER_BYTES..],
                            aad: &record[..HEADER_BYTES],
                        },
                    )
                    .unwrap();
                assert!(plain.iter().all(|byte| *byte == block as u8));
                *offset += plain.len();
            }
        }
    }
    assert!(sender.blocks.is_empty());
}

#[test]
fn rejects_wrong_scope_offsets_capacity_and_sequence_exhaustion() {
    let mut sender = Sender::new(&options()).unwrap();
    let read = || Ok(vec![7; 1024 * 1024]);
    let mut wrong = request(0, 0);
    wrong.epoch = Uuid::new_v4();
    assert!(sender.batch(wrong, read).is_err());
    let mut wrong = request(0, 0);
    wrong.manifest = "wrong";
    assert!(sender.batch(wrong, read).is_err());
    sender.batch(request(0, 0), read).unwrap();
    assert!(sender.batch(request(0, 0), read).is_err());
    sender.batch(request(1, 0), read).unwrap();
    assert!(sender.batch(request(2, 0), read).is_err());
    sender.sequence = u32::MAX;
    assert!(sender
        .batch(request(0, 16 * (MAX_RECORD_BYTES - 88)), read)
        .is_err());
    assert_eq!(sender.sequence, u32::MAX);
}

#[test]
fn honors_the_negotiated_record_size_and_rejects_invalid_sizes() {
    let mut settings = options();
    for size in [88, MAX_RECORD_BYTES + 1] {
        settings.record_bytes = size;
        assert!(Sender::new(&settings).is_err());
    }
    settings.record_bytes = 1024;
    let wire = Sender::new(&settings)
        .unwrap()
        .batch(request(0, 0), || Ok(vec![42; 50_000]))
        .unwrap();
    assert_eq!(records(&wire).len(), BATCH_RECORDS);
    assert!(records(&wire).iter().all(|record| record.len() == 1024));
}
