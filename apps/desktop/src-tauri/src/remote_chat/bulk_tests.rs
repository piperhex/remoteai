use super::*;

pub(super) fn frame(session: &str, payload: usize) -> Vec<u8> {
    let mut bytes = b"CSF1".to_vec();
    bytes.push(session.len() as u8);
    bytes.extend_from_slice(session.as_bytes());
    let mut record = vec![0; RECORD_HEADER_BYTES + TAG_BYTES + payload];
    record[..8].copy_from_slice(b"RAB1\x01\x01\x00\x48");
    record[64..68].copy_from_slice(&(payload as u32).to_be_bytes());
    bytes.extend(record);
    bytes
}

fn batch(frames: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = b"CSFB".to_vec();
    bytes.push(frames.len() as u8);
    for frame in frames {
        bytes.extend_from_slice(&(frame.len() as u32).to_be_bytes());
        bytes.extend_from_slice(frame);
    }
    bytes
}

#[test]
fn bounded_ipc_batches_preserve_independent_wire_frames_and_legacy_single_sends() {
    let frames =
        vec![frame("phone", MAX_RECORD_BYTES - RECORD_HEADER_BYTES - TAG_BYTES); MAX_BATCH_RECORDS];
    let (session, parsed) = parse_frames(&batch(&frames)).unwrap();
    assert_eq!(session, "phone");
    assert_eq!(parsed, frames);
    assert_eq!(parse_frames(&frames[0]).unwrap().1, frames[..1]);
}

#[test]
fn rejects_invalid_batches_before_queueing_any_bytes() {
    let valid = batch(&[frame("phone", 32), frame("phone", 16)]);
    for end in 0..valid.len() {
        assert!(parse_frames(&valid[..end]).is_err());
    }
    let mut trailing = valid.clone();
    trailing.push(0);
    assert!(parse_frames(&trailing).is_err());
    assert!(parse_frames(&batch(&[])).is_err());
    assert!(parse_frames(&batch(&vec![frame("phone", 1); MAX_BATCH_RECORDS + 1])).is_err());
    assert!(parse_frames(&batch(&[frame("phone", 1), frame("other-phone", 1)])).is_err());
    assert!(parse_frames(&batch(&[frame("phone", MAX_RECORD_BYTES)])).is_err());
    let mut forged_length = valid;
    forged_length[5..9].copy_from_slice(&u32::MAX.to_be_bytes());
    assert!(parse_frames(&forged_length).is_err());
}
