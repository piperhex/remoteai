//! Bounded RAB1 batches can move from the native file cipher directly into SCTP.
use super::{model::*, state::State};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

const BATCH_RECORDS: usize = 16;
const RECORD_BYTES: usize = 16 * 1024;
const RECORD_OVERHEAD: usize = 88;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Target {
    pub peer: String,
    pub channel: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Sent {
    pub useful_bytes: usize,
    pub wire_bytes: usize,
}

pub(crate) fn records(batch: Bytes) -> Result<Vec<Bytes>> {
    if batch.len() < 5
        || batch.len() > 5 + BATCH_RECORDS * (4 + RECORD_BYTES)
        || &batch[..4] != b"RAN1"
    {
        return Err(Error::Invalid);
    }
    let count = usize::from(batch[4]);
    if count == 0 || count > BATCH_RECORDS {
        return Err(Error::Invalid);
    }
    let mut offset = 5;
    let mut records = Vec::with_capacity(count);
    for _ in 0..count {
        let length = batch.get(offset..offset + 4).ok_or(Error::Invalid)?;
        let length = u32::from_be_bytes(length.try_into().map_err(|_| Error::Invalid)?) as usize;
        offset += 4;
        if !(RECORD_OVERHEAD + 1..=RECORD_BYTES).contains(&length) {
            return Err(Error::Invalid);
        }
        let record = batch.get(offset..offset + length).ok_or(Error::Invalid)?;
        if &record[..8] != b"RAB1\x01\x01\x00\x48" {
            return Err(Error::Invalid);
        }
        let payload =
            u32::from_be_bytes(record[64..68].try_into().map_err(|_| Error::Invalid)?) as usize;
        if payload + RECORD_OVERHEAD != length {
            return Err(Error::Invalid);
        }
        records.push(batch.slice(offset..offset + length));
        offset += length;
    }
    if offset != batch.len() {
        return Err(Error::Invalid);
    }
    Ok(records)
}

impl State {
    pub(crate) async fn send_file(
        &self,
        owner: &str,
        transfer: (&Target, Bytes),
        cancelled: &AtomicBool,
    ) -> Result<Sent> {
        let (target, batch) = transfer;
        let peer = self.get(owner, &target.peer).await?;
        let channel = peer.channel(&target.channel).await?;
        if channel.spec.label != "remote-ai-file-v1" || channel.spec.negotiated != Some(42) {
            return Err(Error::Invalid);
        }
        let records = records(batch)?;
        let wire_bytes = records.iter().map(Bytes::len).sum::<usize>();
        let useful_bytes = wire_bytes - records.len() * RECORD_OVERHEAD;
        for record in records {
            if cancelled.load(Ordering::Acquire) {
                return Err(Error::Closed);
            }
            channel.send_file(record, cancelled).await?;
        }
        Ok(Sent {
            useful_bytes,
            wire_bytes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_partial_and_malformed_batches_before_sending() {
        for bytes in [
            b"RAN1\0".as_slice(),
            b"RAN1\x11",
            b"RAN1\x01\x00\x00\x40\x01",
        ] {
            assert!(records(Bytes::copy_from_slice(bytes)).is_err());
        }
    }
}
