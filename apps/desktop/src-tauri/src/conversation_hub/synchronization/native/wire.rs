//! AEAD-authenticated binary synchronization records, independently keyed per transfer epoch.
use super::{Error, Result};
use bytes::Bytes;
use chacha20poly1305::{
    aead::{Aead, Payload},
    ChaCha20Poly1305, KeyInit,
};
use uuid::Uuid;
use zeroize::Zeroizing;

const HEADER: usize = 40;
const TAG: usize = 16;
pub(super) const OVERHEAD: usize = HEADER + TAG;
pub(super) const PAYLOAD: usize = 16 * 1024 - HEADER - TAG;
pub(super) const DATA: u8 = 1;
pub(super) const ACK: u8 = 2;

pub(super) struct Cipher {
    send: Zeroizing<[u8; 32]>,
    receive: Zeroizing<[u8; 32]>,
    id: Uuid,
    sent: u32,
    received: u32,
}
pub(super) struct Record {
    pub kind: u8,
    pub offset: u64,
    pub bytes: Vec<u8>,
}

impl Cipher {
    pub(super) fn new(id: Uuid, send: Vec<u8>, receive: Vec<u8>) -> Result<Self> {
        let send = Zeroizing::new(send);
        let receive = Zeroizing::new(receive);
        Ok(Self {
            send: Zeroizing::new(send.as_slice().try_into().map_err(|_| Error::Invalid)?),
            receive: Zeroizing::new(receive.as_slice().try_into().map_err(|_| Error::Invalid)?),
            id,
            sent: 0,
            received: 0,
        })
    }
    pub(super) fn seal(&mut self, kind: u8, offset: u64, bytes: &[u8]) -> Result<Bytes> {
        if bytes.len() > PAYLOAD || !matches!(kind, DATA | ACK) {
            return Err(Error::Invalid);
        }
        self.sent = self.sent.checked_add(1).ok_or(Error::Invalid)?;
        let mut header = [0_u8; HEADER];
        header[..4].copy_from_slice(b"RAS1");
        header[4] = 1;
        header[5] = kind;
        header[8..24].copy_from_slice(self.id.as_bytes());
        header[24..32].copy_from_slice(&offset.to_be_bytes());
        header[32..36].copy_from_slice(&self.sent.to_be_bytes());
        header[36..40].copy_from_slice(&(bytes.len() as u32).to_be_bytes());
        let mut nonce = [0; 12];
        nonce[8..].copy_from_slice(&self.sent.to_be_bytes());
        let encrypted = ChaCha20Poly1305::new(self.send.as_ref().into())
            .encrypt(
                (&nonce).into(),
                Payload {
                    msg: bytes,
                    aad: &header,
                },
            )
            .map_err(|_| Error::Invalid)?;
        Ok([header.as_slice(), encrypted.as_slice()].concat().into())
    }
    pub(super) fn open(&mut self, record: &[u8]) -> Result<Record> {
        if !(HEADER + TAG..=16 * 1024).contains(&record.len())
            || &record[..5] != b"RAS1\x01"
            || record[6..8] != [0, 0]
            || record[8..24] != *self.id.as_bytes()
        {
            return Err(Error::Invalid);
        }
        let number = |range: std::ops::Range<usize>| -> Result<[u8; 4]> {
            record
                .get(range)
                .ok_or(Error::Invalid)?
                .try_into()
                .map_err(|_| Error::Invalid)
        };
        let sequence = u32::from_be_bytes(number(32..36)?);
        let length = u32::from_be_bytes(number(36..40)?) as usize;
        if sequence != self.received.checked_add(1).ok_or(Error::Invalid)?
            || length + HEADER + TAG != record.len()
            || !matches!(record[5], DATA | ACK)
        {
            return Err(Error::Invalid);
        }
        let mut nonce = [0; 12];
        nonce[8..].copy_from_slice(&sequence.to_be_bytes());
        let bytes = ChaCha20Poly1305::new(self.receive.as_ref().into())
            .decrypt(
                (&nonce).into(),
                Payload {
                    msg: &record[HEADER..],
                    aad: &record[..HEADER],
                },
            )
            .map_err(|_| Error::Invalid)?;
        self.received = sequence;
        let offset = u64::from_be_bytes(record[24..32].try_into().map_err(|_| Error::Invalid)?);
        Ok(Record {
            kind: record[5],
            offset,
            bytes,
        })
    }
}
