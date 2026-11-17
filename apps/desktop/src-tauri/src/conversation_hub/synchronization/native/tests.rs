use super::{wire::*, *};

#[test]
fn binary_records_bind_transfer_offset_direction_and_sequence() {
    let id = uuid::Uuid::new_v4();
    let mut sender = Cipher::new(id, vec![1; 32], vec![2; 32]).unwrap();
    let mut receiver = Cipher::new(id, vec![2; 32], vec![1; 32]).unwrap();
    let record = sender.seal(DATA, 1024, b"conversation archive").unwrap();
    for index in [5, 8, 24, 32, 36, record.len() - 1] {
        let mut invalid = record.to_vec();
        invalid[index] ^= 1;
        assert!(receiver.open(&invalid).is_err());
    }
    let plain = receiver.open(&record).unwrap();
    assert_eq!(plain.offset, 1024);
    assert_eq!(plain.bytes, b"conversation archive");
    assert!(receiver.open(&record).is_err());
    assert!(sender.open(&record).is_err());
    let ack = receiver.seal(ACK, 1044, &[]).unwrap();
    assert_eq!(sender.open(&ack).unwrap().kind, ACK);
}

#[test]
fn binary_storage_persists_only_valid_written_prefixes() {
    use super::super::{binary, persistence, Transfer, TRANSFERS};
    use std::{fs, time::Instant};
    let id = uuid::Uuid::new_v4().to_string();
    let root = std::env::temp_dir().join(format!("remoteai-native-sync-{id}"));
    fs::create_dir(&root).unwrap();
    fs::write(root.join("bundle.zip"), []).unwrap();
    let content = vec![42; binary::BATCH_BYTES];
    let hash = format!("{:x}", <sha2::Sha256 as sha2::Digest>::digest(&content));
    TRANSFERS.lock().unwrap().insert(
        id.clone(),
        Transfer {
            root: root.clone(),
            size: content.len() as u64,
            sha256: hash.clone(),
            written: 0,
            source: None,
            plan: None,
            touched: Instant::now(),
            retain: false,
            original_size: 0,
            resume_token: uuid::Uuid::new_v4().to_string(),
        },
    );
    assert!(binary::destination(&id, 0, content.len() as u64, &hash).is_ok());
    assert!(binary::write(&id, 1, &content).is_err());
    assert_eq!(
        binary::write(&id, 0, &content).unwrap(),
        content.len() as u64
    );
    assert!(binary::verify(&id).is_ok());
    let mut entry = TRANSFERS.lock().unwrap().remove(&id).unwrap();
    let restored = persistence::load(&root, &entry.resume_token).unwrap();
    assert_eq!(restored.written, content.len() as u64);
    assert!(binary::reader(&id, 0).is_err());
    entry.resume_token.clear();
    drop(restored);
    drop(entry);
    assert!(!root.exists());
}

pub(super) struct Bundles {
    pub(super) source: String,
    pub(super) destination: String,
    size: u64,
    hash: String,
}

impl Bundles {
    pub(super) fn new(size: usize) -> Self {
        use super::super::{Transfer, TRANSFERS};
        use rand::RngCore;
        use std::fs;
        let mut bytes = vec![0; size];
        rand::rng().fill_bytes(&mut bytes);
        let hash = format!("{:x}", <sha2::Sha256 as sha2::Digest>::digest(&bytes));
        let create = |source| {
            let id = uuid::Uuid::new_v4().to_string();
            let root = std::env::temp_dir().join(format!("remoteai-native-sync-{id}"));
            fs::create_dir(&root).unwrap();
            fs::write(
                root.join("bundle.zip"),
                if source { bytes.as_slice() } else { &[] },
            )
            .unwrap();
            TRANSFERS.lock().unwrap().insert(
                id.clone(),
                Transfer {
                    root,
                    size: size as u64,
                    sha256: hash.clone(),
                    written: if source { size as u64 } else { 0 },
                    source: None,
                    plan: None,
                    touched: Instant::now(),
                    retain: false,
                    original_size: 0,
                    resume_token: uuid::Uuid::new_v4().to_string(),
                },
            );
            id
        };
        Self {
            source: create(true),
            destination: create(false),
            size: size as u64,
            hash,
        }
    }
    fn request(&self, direction: Direction, transfer: uuid::Uuid, offset: u64) -> Start {
        Start {
            bundle: match direction {
                Direction::Send => self.source.clone(),
                Direction::Receive => self.destination.clone(),
            },
            direction,
            transfer_id: transfer.to_string(),
            epoch: uuid::Uuid::new_v4().to_string(),
            size: self.size,
            sha256: self.hash.clone(),
            offset,
            cipher: String::new(),
            target: Target {
                peer: String::new(),
                channel: String::new(),
            },
        }
    }
}
impl Drop for Bundles {
    fn drop(&mut self) {
        let mut transfers = super::super::TRANSFERS.lock().unwrap();
        for id in [&self.source, &self.destination] {
            if let Some(mut entry) = transfers.remove(id) {
                entry.resume_token.clear();
            }
        }
    }
}

fn job(offset: u64) -> Job {
    Job {
        written: AtomicU64::new(offset),
        elapsed_ms: AtomicU64::new(0),
        status: AtomicU8::new(0),
        cancelled: AtomicBool::new(false),
        interrupt: Notify::new(),
        finished: Notify::new(),
        started: Instant::now(),
    }
}

#[tokio::test]
async fn native_pipeline_resumes_a_durable_prefix_and_verifies_the_saved_file() {
    use super::super::binary;
    use std::io::Read;
    let bundles = Bundles::new(3 * binary::BATCH_BYTES + 733);
    let mut source = binary::reader(&bundles.source, 0).unwrap();
    let mut prefix = vec![0; binary::BATCH_BYTES];
    source.file.read_exact(&mut prefix).unwrap();
    drop(source);
    binary::write(&bundles.destination, 0, &prefix).unwrap();
    let offset = prefix.len() as u64;
    let id = uuid::Uuid::new_v4();
    let (mut left, mut right) = crate::native_rtc::stream::loopback_pair(id).await;
    let sender = bundles.request(Direction::Send, id, offset);
    let receiver = bundles.request(Direction::Receive, id, offset);
    let sent = job(offset);
    let received = job(offset);
    let left_cipher = Cipher::new(id, vec![1; 32], vec![2; 32]).unwrap();
    let right_cipher = Cipher::new(id, vec![2; 32], vec![1; 32]).unwrap();
    let (send, receive) = tokio::join!(
        transfer::run(
            transfer::Context {
                request: &sender,
                job: &sent
            },
            &mut left,
            left_cipher,
            Some(binary::reader(&bundles.source, offset).unwrap())
        ),
        transfer::run(
            transfer::Context {
                request: &receiver,
                job: &received
            },
            &mut right,
            right_cipher,
            None
        ),
    );
    left.close_fixture().await;
    right.close_fixture().await;
    send.unwrap();
    receive.unwrap();
    assert_eq!(sent.written.load(Ordering::Acquire), bundles.size);
    assert_eq!(received.written.load(Ordering::Acquire), bundles.size);
    binary::verify(&bundles.destination).unwrap();
}

#[tokio::test]
async fn native_bridge_forwards_authenticated_batches_and_durable_acknowledgements() {
    use super::super::binary;
    let bundles = Bundles::new(binary::BATCH_BYTES + 321);
    let first = uuid::Uuid::new_v4();
    let second = uuid::Uuid::new_v4();
    let (mut source, inbound) = crate::native_rtc::stream::loopback_pair(first).await;
    let (outbound, mut destination) = crate::native_rtc::stream::loopback_pair(second).await;
    let close_inbound = inbound.fixture_closer();
    let close_outbound = outbound.fixture_closer();
    let sender = bundles.request(Direction::Send, first, 0);
    let receiver = bundles.request(Direction::Receive, second, 0);
    let sent = job(0);
    let received = job(0);
    let forwarded = job(0);
    let (send, forward, receive) = tokio::join!(
        transfer::run(
            transfer::Context {
                request: &sender,
                job: &sent
            },
            &mut source,
            Cipher::new(first, vec![1; 32], vec![2; 32]).unwrap(),
            Some(binary::reader(&bundles.source, 0).unwrap())
        ),
        bridge::run(
            bridge::Bound {
                port: inbound,
                cipher: Some(Cipher::new(first, vec![2; 32], vec![1; 32]).unwrap())
            },
            bridge::Bound {
                port: outbound,
                cipher: Some(Cipher::new(second, vec![3; 32], vec![4; 32]).unwrap())
            },
            &forwarded,
            (0, bundles.size)
        ),
        transfer::run(
            transfer::Context {
                request: &receiver,
                job: &received
            },
            &mut destination,
            Cipher::new(second, vec![4; 32], vec![3; 32]).unwrap(),
            None
        ),
    );
    source.close_fixture().await;
    destination.close_fixture().await;
    close_inbound.await;
    close_outbound.await;
    send.unwrap();
    forward.unwrap();
    receive.unwrap();
    assert_eq!(forwarded.written.load(Ordering::Acquire), bundles.size);
    binary::verify(&bundles.destination).unwrap();
}
