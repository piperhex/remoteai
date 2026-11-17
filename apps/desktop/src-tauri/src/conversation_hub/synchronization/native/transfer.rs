use super::super::binary::{self, BATCH_BYTES};
use super::{
    wire::{self, Cipher},
    Direction, Error, Job, Port, Result, Start,
};
use std::{io::Read, sync::atomic::Ordering};

#[derive(Clone, Copy)]
pub(super) struct Context<'a> {
    pub request: &'a Start,
    pub job: &'a Job,
}
impl Context<'_> {
    fn check(&self) -> Result<()> {
        if self.job.cancelled.load(Ordering::Acquire) {
            Err(Error::Cancelled)
        } else {
            Ok(())
        }
    }
    async fn record(&self, port: &mut Port) -> Result<bytes::Bytes> {
        self.check()?;
        tokio::select! {
            record = port.receive() => record.map_err(|_| Error::Unavailable),
            _ = self.job.interrupt.notified() => Err(Error::Cancelled),
        }
    }
}

pub(super) async fn run(
    context: Context<'_>,
    port: &mut Port,
    cipher: Cipher,
    reader: Option<binary::Reader>,
) -> Result<()> {
    match context.request.direction {
        Direction::Send => send(context, port, cipher, reader.ok_or(Error::Invalid)?).await,
        Direction::Receive => receive(context, port, cipher).await,
    }
}

async fn send(
    context: Context<'_>,
    port: &mut Port,
    mut cipher: Cipher,
    mut reader: binary::Reader,
) -> Result<()> {
    let Context { request, job } = context;
    let mut offset = request.offset;
    while offset < request.size {
        if job.cancelled.load(Ordering::Acquire) {
            return Err(Error::Cancelled);
        }
        let length = BATCH_BYTES.min((request.size - offset) as usize);
        (reader, cipher) = send_batch(
            reader,
            cipher,
            port,
            Batch {
                job,
                offset,
                length,
            },
        )
        .await?;
        offset += length as u64;
        let record = cipher.open(&context.record(port).await?)?;
        if record.kind != wire::ACK || record.offset != offset || !record.bytes.is_empty() {
            return Err(Error::Invalid);
        }
        job.written.store(offset, Ordering::Release);
    }
    Ok(())
}

struct Batch<'a> {
    job: &'a Job,
    offset: u64,
    length: usize,
}

async fn send_batch(
    mut reader: binary::Reader,
    mut cipher: Cipher,
    port: &Port,
    batch: Batch<'_>,
) -> Result<(binary::Reader, Cipher)> {
    let Batch {
        job,
        offset,
        length,
    } = batch;
    let (reader, cipher, records) = tauri::async_runtime::spawn_blocking(move || {
        let mut bytes = vec![0; length];
        reader
            .file
            .read_exact(&mut bytes)
            .map_err(|_| Error::Unavailable)?;
        let records = bytes
            .chunks(wire::PAYLOAD)
            .enumerate()
            .map(|(index, bytes)| {
                cipher.seal(wire::DATA, offset + (index * wire::PAYLOAD) as u64, bytes)
            })
            .collect::<Result<Vec<_>>>()?;
        Ok::<_, Error>((reader, cipher, records))
    })
    .await
    .map_err(|_| Error::Unavailable)??;
    for record in records {
        port.send(record, &job.cancelled)
            .await
            .map_err(|_| Error::Unavailable)?;
    }
    Ok((reader, cipher))
}

async fn receive(context: Context<'_>, port: &mut Port, mut cipher: Cipher) -> Result<()> {
    let Context { request, job } = context;
    let mut offset = request.offset;
    while offset < request.size {
        let length = BATCH_BYTES.min((request.size - offset) as usize);
        let mut records = Vec::with_capacity(length.div_ceil(wire::PAYLOAD));
        let mut total = 0;
        while total < length {
            let record = context.record(port).await?;
            // Ciphertext has a fixed overhead. Validate bounds before buffering or decrypting.
            let payload = record
                .len()
                .checked_sub(wire::OVERHEAD)
                .filter(|size| *size > 0)
                .ok_or(Error::Invalid)?;
            if payload != wire::PAYLOAD.min(length - total) {
                return Err(Error::Invalid);
            }
            total = total
                .checked_add(payload)
                .filter(|size| *size <= length)
                .ok_or(Error::Invalid)?;
            records.push(record);
        }
        let bundle = request.bundle.clone();
        let finished = offset + length as u64 == request.size;
        cipher = tauri::async_runtime::spawn_blocking(move || {
            let mut bytes = Vec::with_capacity(length);
            for record in records {
                let record = cipher.open(&record)?;
                if record.kind != wire::DATA || record.offset != offset + bytes.len() as u64 {
                    return Err(Error::Invalid);
                }
                bytes.extend_from_slice(&record.bytes);
            }
            binary::write(&bundle, offset, &bytes).map_err(|_| Error::Unavailable)?;
            if finished {
                binary::verify(&bundle).map_err(|_| Error::Invalid)?;
            }
            Ok::<_, Error>(cipher)
        })
        .await
        .map_err(|_| Error::Unavailable)??;
        context.check()?;
        offset += length as u64;
        job.written.store(offset, Ordering::Release);
        let ack = cipher.seal(wire::ACK, offset, &[])?;
        port.send(ack, &job.cancelled)
            .await
            .map_err(|_| Error::Unavailable)?;
    }
    Ok(())
}
