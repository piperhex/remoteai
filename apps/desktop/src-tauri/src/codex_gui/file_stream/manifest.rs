//! Content identities are computed from the authorized open handle, never size/mtime alone.
use super::super::error::{GuiError, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    sync::atomic::{AtomicBool, Ordering},
};

pub(super) const BLOCK_BYTES: usize = 1024 * 1024;
const PAGE_BLOCKS: usize = 256;
const MAX_BLOCKS: u64 = 65_536;
const DOMAIN: &[u8] = b"remote-ai:file-manifest:v1:sha256\0";

fn hex(bytes: impl AsRef<[u8]>) -> String {
    const DIGITS: &[u8] = b"0123456789abcdef";
    bytes
        .as_ref()
        .iter()
        .flat_map(|byte| {
            [
                DIGITS[(byte >> 4) as usize] as char,
                DIGITS[(byte & 15) as usize] as char,
            ]
        })
        .collect()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManifestInfo {
    version: u8,
    algorithm: &'static str,
    pub manifest_id: String,
    pub size: u64,
    block_size: usize,
    block_count: usize,
    file_hash: String,
    source_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManifestPage {
    manifest_id: String,
    page: usize,
    total_pages: usize,
    hashes: Vec<String>,
}

pub(super) struct Manifest {
    pub info: ManifestInfo,
    hashes: Vec<[u8; 32]>,
}

fn read_block(file: &mut File, size: u64, block: usize) -> Result<Vec<u8>> {
    let offset = (block as u64) * BLOCK_BYTES as u64;
    if offset >= size {
        return Err(GuiError::InvalidRequest);
    }
    let length = (size - offset).min(BLOCK_BYTES as u64) as usize;
    let mut bytes = vec![0; length];
    file.seek(SeekFrom::Start(offset))
        .map_err(|_| GuiError::FileRead)?;
    file.read_exact(&mut bytes)
        .map_err(|_| GuiError::FileChanged)?;
    Ok(bytes)
}

impl Manifest {
    pub fn scan(file: &mut File, revision: &str, cancelled: &AtomicBool) -> Result<Self> {
        let before = file.metadata().map_err(|_| GuiError::FileRead)?;
        let count = before.len().div_ceil(BLOCK_BYTES as u64);
        if count > MAX_BLOCKS {
            return Err(GuiError::FileTooLarge);
        }
        let mut whole = Sha256::new();
        let mut hashes = Vec::with_capacity(count as usize);
        for block in 0..count as usize {
            if cancelled.load(Ordering::Relaxed) {
                return Err(GuiError::FileExpired);
            }
            let bytes = read_block(file, before.len(), block)?;
            whole.update(&bytes);
            hashes.push(Sha256::digest(&bytes).into());
        }
        let after = file.metadata().map_err(|_| GuiError::FileRead)?;
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err(GuiError::FileChanged);
        }
        Ok(Self::from_hashes(
            before.len(),
            hashes,
            whole.finalize().into(),
            revision,
        ))
    }

    fn from_hashes(size: u64, hashes: Vec<[u8; 32]>, whole: [u8; 32], revision: &str) -> Self {
        let mut identity = Sha256::new();
        identity.update(DOMAIN);
        identity.update(size.to_be_bytes());
        identity.update((BLOCK_BYTES as u32).to_be_bytes());
        identity.update((hashes.len() as u32).to_be_bytes());
        for hash in &hashes {
            identity.update(hash);
        }
        identity.update(whole);
        Self {
            info: ManifestInfo {
                version: 1,
                algorithm: "sha256",
                manifest_id: hex(identity.finalize()),
                size,
                block_size: BLOCK_BYTES,
                block_count: hashes.len(),
                file_hash: hex(whole),
                source_version: revision.to_owned(),
            },
            hashes,
        }
    }

    pub fn page(&self, index: usize) -> Result<ManifestPage> {
        let total_pages = self.hashes.len().div_ceil(PAGE_BLOCKS);
        if index >= total_pages {
            return Err(GuiError::InvalidRequest);
        }
        let start = index * PAGE_BLOCKS;
        let end = (start + PAGE_BLOCKS).min(self.hashes.len());
        Ok(ManifestPage {
            manifest_id: self.info.manifest_id.clone(),
            page: index,
            total_pages,
            hashes: self.hashes[start..end].iter().map(hex).collect(),
        })
    }

    pub fn read(&self, file: &mut File, block: usize) -> Result<Vec<u8>> {
        let expected = self.hashes.get(block).ok_or(GuiError::InvalidRequest)?;
        let bytes = read_block(file, self.info.size, block)?;
        let actual: [u8; 32] = Sha256::digest(&bytes).into();
        if &actual != expected {
            return Err(GuiError::FileChanged);
        }
        Ok(bytes)
    }
}
