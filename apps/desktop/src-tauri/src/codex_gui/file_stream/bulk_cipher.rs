//! Stateful RAB1 encryption. Keys and verified plaintext never leave the native sender after setup.
use super::super::error::{GuiError, Result};
use chacha20poly1305::{aead::AeadInPlace, ChaCha20Poly1305, KeyInit, Nonce};
use std::collections::HashMap;
use uuid::Uuid;
use zeroize::Zeroizing;

#[cfg(test)]
#[path = "bulk_cipher_tests.rs"]
mod tests;

pub(super) const HEADER_BYTES: usize = 72;
pub(super) const TAG_BYTES: usize = 16;
pub(super) const MAX_RECORD_BYTES: usize = 16 * 1024;
const BATCH_RECORDS: usize = 16;
const ACTIVE_BLOCKS: usize = 2;

struct Block {
    index: usize,
    bytes: Zeroizing<Vec<u8>>,
    offset: usize,
}

pub(super) struct Sender {
    key: Zeroizing<[u8; 32]>,
    transfer: Uuid,
    epoch: Uuid,
    manifest: String,
    payload_bytes: usize,
    sequence: u32,
    blocks: HashMap<Uuid, Block>,
}

pub(super) struct Batch<'a> {
    pub epoch: Uuid,
    pub manifest: &'a str,
    pub request: Uuid,
    pub block: usize,
    pub offset: usize,
}

impl Sender {
    pub fn new(options: &super::bulk_encrypted::OpenSender) -> Result<Self> {
        if !(HEADER_BYTES + TAG_BYTES + 1..=MAX_RECORD_BYTES).contains(&options.record_bytes) {
            return Err(GuiError::InvalidRequest);
        }
        Ok(Self {
            key: Zeroizing::new(options.key),
            transfer: Uuid::parse_str(&options.thread_id).map_err(|_| GuiError::InvalidRequest)?,
            epoch: options.epoch,
            manifest: options.manifest_id.clone(),
            payload_bytes: options.record_bytes - HEADER_BYTES - TAG_BYTES,
            sequence: 0,
            blocks: HashMap::new(),
        })
    }

    pub fn batch(
        &mut self,
        request: Batch<'_>,
        read: impl FnOnce() -> Result<Vec<u8>>,
    ) -> Result<Vec<u8>> {
        if request.epoch != self.epoch || request.manifest != self.manifest {
            return Err(GuiError::FileExpired);
        }
        self.prepare(&request, read)?;
        let mut block = self
            .blocks
            .remove(&request.request)
            .ok_or(GuiError::InvalidRequest)?;
        let result = self.encrypt(&request, &mut block);
        if result.is_ok() && block.offset < block.bytes.len() {
            self.blocks.insert(request.request, block);
        }
        result
    }

    fn prepare(
        &mut self,
        request: &Batch<'_>,
        read: impl FnOnce() -> Result<Vec<u8>>,
    ) -> Result<()> {
        if let Some(block) = self.blocks.get(&request.request) {
            if block.index != request.block || block.offset != request.offset {
                return Err(GuiError::InvalidRequest);
            }
            return Ok(());
        }
        if request.offset != 0
            || self.blocks.len() >= ACTIVE_BLOCKS
            || self
                .blocks
                .values()
                .any(|block| block.index == request.block)
        {
            return Err(GuiError::InvalidRequest);
        }
        let bytes = Zeroizing::new(read()?);
        if bytes.is_empty() || bytes.len() > super::manifest::BLOCK_BYTES {
            return Err(GuiError::InvalidRequest);
        }
        self.blocks.insert(
            request.request,
            Block {
                index: request.block,
                bytes,
                offset: 0,
            },
        );
        Ok(())
    }

    fn encrypt(&mut self, request: &Batch<'_>, block: &mut Block) -> Result<Vec<u8>> {
        let remaining = block.bytes.len() - block.offset;
        let count = remaining.div_ceil(self.payload_bytes).min(BATCH_RECORDS);
        let mut output = Vec::with_capacity(5 + count * (4 + MAX_RECORD_BYTES));
        output.extend_from_slice(b"RAN1");
        output.push(count as u8);
        let cipher = ChaCha20Poly1305::new((&*self.key).into());
        for _ in 0..count {
            let length = self.payload_bytes.min(block.bytes.len() - block.offset);
            // Allocate a new nonce before encryption; failures never make it reusable.
            self.sequence = self.sequence.checked_add(1).ok_or(GuiError::FileExpired)?;
            let header = self.header(request, block.offset, length)?;
            let mut nonce = [0u8; 12];
            nonce[8..].copy_from_slice(&self.sequence.to_be_bytes());
            output.extend_from_slice(&((HEADER_BYTES + length + TAG_BYTES) as u32).to_be_bytes());
            output.extend_from_slice(&header);
            let start = output.len();
            output.extend_from_slice(&block.bytes[block.offset..block.offset + length]);
            let tag = cipher
                .encrypt_in_place_detached(Nonce::from_slice(&nonce), &header, &mut output[start..])
                .map_err(|_| GuiError::Integrity)?;
            output.extend_from_slice(&tag);
            block.offset += length;
        }
        Ok(output)
    }

    fn header(
        &self,
        request: &Batch<'_>,
        offset: usize,
        length: usize,
    ) -> Result<[u8; HEADER_BYTES]> {
        let mut header = [0u8; HEADER_BYTES];
        header[..8].copy_from_slice(b"RAB1\x01\x01\x00\x48");
        header[8..24].copy_from_slice(self.transfer.as_bytes());
        header[24..40].copy_from_slice(self.epoch.as_bytes());
        header[40..56].copy_from_slice(request.request.as_bytes());
        let block = u32::try_from(request.block).map_err(|_| GuiError::InvalidRequest)?;
        for (index, value) in [block, offset as u32, length as u32, self.sequence]
            .iter()
            .enumerate()
        {
            header[56 + index * 4..60 + index * 4].copy_from_slice(&value.to_be_bytes());
        }
        Ok(header)
    }
}
