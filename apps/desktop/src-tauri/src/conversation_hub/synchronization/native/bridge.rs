//! Desktop-to-desktop forwarding through a third desktop, without Base64 or WebView payload copies.
use super::{
    authorize, boundary,
    wire::{self, Cipher},
    BulkContext, Error, Job, Port, Result, State, Target,
};
use serde::Deserialize;
use std::sync::atomic::Ordering;
use tauri::{Manager, Webview};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Endpoint {
    cipher: String,
    target: Target,
    transfer_id: String,
    epoch: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Request {
    source: Endpoint,
    destination: Endpoint,
    size: u64,
    offset: u64,
    sha256: String,
}

pub(super) struct Bound {
    pub port: Port,
    pub cipher: Option<Cipher>,
}
impl Bound {
    async fn close(self) {
        self.port.close().await;
    }
    fn cipher(&mut self) -> Result<&mut Cipher> {
        self.cipher.as_mut().ok_or(Error::Invalid)
    }
}

async fn bind(app: &tauri::AppHandle, endpoint: Endpoint, hash: String) -> Result<Bound> {
    let id = Uuid::parse_str(&endpoint.transfer_id).map_err(|_| Error::Invalid)?;
    Uuid::parse_str(&endpoint.epoch).map_err(|_| Error::Invalid)?;
    let crypto = app
        .state::<crate::remote_chat::crypto::State>()
        .inner()
        .clone();
    let context = BulkContext {
        transfer_id: endpoint.transfer_id,
        manifest_id: hash,
        epoch: endpoint.epoch,
    };
    let cipher = tauri::async_runtime::spawn_blocking(move || {
        let keys = crypto
            .session(&endpoint.cipher)
            .map_err(|_| Error::Invalid)?
            .lock()
            .map_err(|_| Error::Unavailable)?
            .bulk_keys(context)
            .map_err(|_| Error::Invalid)?;
        Cipher::new(id, keys.send_key, keys.receive_key)
    })
    .await
    .map_err(|_| Error::Unavailable)??;
    let port = app
        .state::<crate::native_rtc::State>()
        .stream(&endpoint.target, id)
        .await
        .map_err(|_| Error::Unavailable)?;
    Ok(Bound {
        port,
        cipher: Some(cipher),
    })
}

#[tauri::command]
pub(crate) async fn codex_conversation_sync_native_bridge(
    app: tauri::AppHandle,
    window: Webview,
    request: Request,
) -> std::result::Result<String, String> {
    authorize(&window)?;
    start(&app, request).await.map_err(boundary)
}

async fn start(app: &tauri::AppHandle, request: Request) -> Result<String> {
    if request.size == 0
        || request.offset > request.size
        || request.sha256.len() != 64
        || !request.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(Error::Invalid);
    }
    let source = bind(app, request.source, request.sha256.clone()).await?;
    let destination = match bind(app, request.destination, request.sha256).await {
        Ok(destination) => destination,
        Err(error) => {
            source.close().await;
            return Err(error);
        }
    };
    let (id, job) = match app.state::<State>().register(request.offset).await {
        Ok(registered) => registered,
        Err(error) => {
            source.close().await;
            destination.close().await;
            return Err(error);
        }
    };
    tauri::async_runtime::spawn(async move {
        job.finish(run(source, destination, &job, (request.offset, request.size)).await);
    });
    Ok(id)
}

pub(super) async fn run(
    mut source: Bound,
    mut destination: Bound,
    job: &Job,
    range: (u64, u64),
) -> Result<()> {
    let result = forward(&mut source, &mut destination, job, range).await;
    source.close().await;
    destination.close().await;
    result
}

async fn forward(
    source: &mut Bound,
    destination: &mut Bound,
    job: &Job,
    range: (u64, u64),
) -> Result<()> {
    let (mut offset, size) = range;
    while offset < size {
        let length = super::super::binary::BATCH_BYTES.min((size - offset) as usize);
        let mut records = Vec::with_capacity(length.div_ceil(wire::PAYLOAD));
        let mut total = 0;
        while total < length {
            let record = job.record(&mut source.port).await?;
            let payload = record
                .len()
                .checked_sub(wire::OVERHEAD)
                .ok_or(Error::Invalid)?;
            if payload != wire::PAYLOAD.min(length - total) {
                return Err(Error::Invalid);
            }
            total += payload;
            records.push(record);
        }
        // Move both native ciphers into one blocking job; only bounded ciphertext records remain async.
        let source_cipher = source.cipher.take().ok_or(Error::Invalid)?;
        let destination_cipher = destination.cipher.take().ok_or(Error::Invalid)?;
        let (source_cipher, destination_cipher, records) =
            transcode(source_cipher, destination_cipher, records, offset).await?;
        source.cipher = Some(source_cipher);
        destination.cipher = Some(destination_cipher);
        for record in records {
            destination
                .port
                .send(record, &job.cancelled)
                .await
                .map_err(|_| Error::Unavailable)?;
        }
        offset += length as u64;
        let ack = job.record(&mut destination.port).await?;
        let ack = destination.cipher()?.open(&ack)?;
        if ack.kind != wire::ACK || ack.offset != offset || !ack.bytes.is_empty() {
            return Err(Error::Invalid);
        }
        let ack = source.cipher()?.seal(wire::ACK, offset, &[])?;
        source
            .port
            .send(ack, &job.cancelled)
            .await
            .map_err(|_| Error::Unavailable)?;
        job.written.store(offset, Ordering::Release);
    }
    Ok(())
}

async fn transcode(
    mut source: Cipher,
    mut destination: Cipher,
    records: Vec<bytes::Bytes>,
    offset: u64,
) -> Result<(Cipher, Cipher, Vec<bytes::Bytes>)> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut position = offset;
        let records = records
            .iter()
            .map(|record| {
                let record = source.open(record)?;
                if record.kind != wire::DATA || record.offset != position {
                    return Err(Error::Invalid);
                }
                let next = destination.seal(wire::DATA, position, &record.bytes)?;
                position += record.bytes.len() as u64;
                Ok(next)
            })
            .collect::<Result<Vec<_>>>()?;
        Ok((source, destination, records))
    })
    .await
    .map_err(|_| Error::Unavailable)?
}
