//! Length-delimited RAB1 records. The IPC batch header never travels over the network.
use crate::{Error, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(super) const MAX_RECORD: usize = 16 * 1024;
pub(super) const MAX_BATCH: usize = 5 + 16 * (4 + MAX_RECORD);
const RECORD_OVERHEAD: usize = 88;
const HELLO: &[u8; 8] = b"RAFILE01";

pub(super) fn validate_record(bytes: &[u8]) -> Result<()> {
    if bytes.len() <= RECORD_OVERHEAD
        || bytes.len() > MAX_RECORD
        || &bytes[..8] != b"RAB1\x01\x01\x00\x48"
    {
        return Err(Error::Invalid);
    }
    let length = u32::from_be_bytes(bytes[64..68].try_into().map_err(|_| Error::Invalid)?);
    if length as usize + RECORD_OVERHEAD != bytes.len() {
        return Err(Error::Invalid);
    }
    Ok(())
}

pub(super) fn validate_batch(bytes: &[u8]) -> Result<()> {
    if bytes.len() < 5
        || bytes.len() > MAX_BATCH
        || &bytes[..4] != b"RAN1"
        || !(1..=16).contains(&bytes[4])
    {
        return Err(Error::Invalid);
    }
    let mut remaining = &bytes[5..];
    for _ in 0..bytes[4] {
        let length = remaining.get(..4).ok_or(Error::Invalid)?;
        let length = u32::from_be_bytes(length.try_into().map_err(|_| Error::Invalid)?) as usize;
        remaining = &remaining[4..];
        validate_record(remaining.get(..length).ok_or(Error::Invalid)?)?;
        remaining = &remaining[length..];
    }
    if !remaining.is_empty() {
        return Err(Error::Invalid);
    }
    Ok(())
}

pub(super) async fn handshake(
    stream: &mut (impl AsyncReadExt + AsyncWriteExt + Unpin),
) -> Result<()> {
    stream.write_all(HELLO).await?;
    let mut hello = [0; HELLO.len()];
    stream.read_exact(&mut hello).await?;
    if &hello != HELLO {
        return Err(Error::Invalid);
    }
    Ok(())
}

pub(super) async fn read_record(read: &mut (impl AsyncReadExt + Unpin)) -> Result<Vec<u8>> {
    let length = read.read_u32().await? as usize;
    if !(RECORD_OVERHEAD + 1..=MAX_RECORD).contains(&length) {
        return Err(Error::Invalid);
    }
    let mut bytes = vec![0; length];
    read.read_exact(&mut bytes).await?;
    validate_record(&bytes)?;
    Ok(bytes)
}
