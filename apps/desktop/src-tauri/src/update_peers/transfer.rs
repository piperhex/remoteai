use std::{sync::Arc, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine};
use csw_chat_connectivity::{Connection, Event};
use serde::{Deserialize, Serialize};

use super::{cache::Cache, Error, Result, MAX_PACKAGE_BYTES};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const IDLE_TIMEOUT: Duration = Duration::from_secs(8);
const CHUNK_BYTES: usize = 64 * 1024;
// Two concurrent uploads are each capped at 1 MiB/s (2 MiB/s per desktop).
const UPLOAD_BYTES_PER_SECOND: usize = 1024 * 1024;
const RATE_WINDOW: Duration = Duration::from_secs(15);
const MIN_DOWNLOAD_BYTES_PER_SECOND: usize = 64 * 1024;

struct DownloadRate {
    since: tokio::time::Instant,
    bytes: usize,
}

impl DownloadRate {
    fn check(&mut self, bytes: usize) -> Result<()> {
        let elapsed = self.since.elapsed();
        if elapsed < RATE_WINDOW {
            return Ok(());
        }
        if bytes.saturating_sub(self.bytes) as f64 / elapsed.as_secs_f64()
            < MIN_DOWNLOAD_BYTES_PER_SECOND as f64
        {
            return Err(Error::Unavailable);
        }
        self.since = tokio::time::Instant::now();
        self.bytes = bytes;
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum Frame {
    Get { artifact: String },
    Header { size: usize },
    Chunk { offset: usize, data: String },
    Complete,
    Received,
}

async fn send(connection: &Connection, frame: &Frame) -> Result<()> {
    connection
        .send(serde_json::to_string(frame).map_err(|_| Error::Invalid)?)
        .await?;
    Ok(())
}

async fn opened(connection: &Connection) -> Result<Option<Frame>> {
    let mut diagnostic = None;
    let mut stream_open = false;
    let result = tokio::time::timeout(CONNECT_TIMEOUT, async {
        loop {
            match connection.receive().await {
                // The native engine can open a socket before its route watcher has caught up.
                // Wait through that initial reconnect; never restart after package bytes arrive.
                Some(Event::Open) => stream_open = true,
                Some(Event::Status { route }) if stream_open => {
                    if route.direct {
                        return Ok(None);
                    }
                    stream_open = false;
                }
                Some(Event::Data { text }) if stream_open => {
                    // A request can arrive before the status event; preserve it for the seeder.
                    return serde_json::from_str(&text)
                        .map(Some)
                        .map_err(|_| Error::Invalid);
                }
                Some(Event::Closed) | None => return Err(Error::Unavailable),
                Some(Event::Diagnostic { stage, snapshot }) => diagnostic = Some((stage, snapshot)),
                _ => {}
            }
        }
    })
    .await;
    if !matches!(&result, Ok(Ok(_))) {
        eprintln!("update peer connection unavailable: {diagnostic:?}");
    }
    result.map_err(|_| Error::Unavailable)?
}

async fn receive(connection: &Connection) -> Result<Frame> {
    let result = tokio::time::timeout(IDLE_TIMEOUT, async {
        loop {
            match connection.receive().await {
                Some(Event::Data { text }) => {
                    return serde_json::from_str(&text).map_err(|_| Error::Invalid)
                }
                Some(Event::Closed | Event::Open) | None => {
                    eprintln!("update package stream closed or restarted");
                    return Err(Error::Unavailable);
                }
                Some(Event::Status { route }) if !route.direct => {
                    eprintln!("update package direct route lost");
                    return Err(Error::Unavailable);
                }
                _ => {}
            }
        }
    })
    .await;
    if result.is_err() {
        eprintln!("update package stream timed out waiting for data");
    }
    result.map_err(|_| Error::Unavailable)?
}

pub(super) async fn download(
    connection: &Connection,
    artifact: &str,
    mut progress: impl FnMut(usize, Option<u64>),
) -> Result<Vec<u8>> {
    if opened(connection).await?.is_some() {
        return Err(Error::Invalid);
    }
    send(
        connection,
        &Frame::Get {
            artifact: artifact.into(),
        },
    )
    .await?;
    let Frame::Header { size } = receive(connection).await? else {
        return Err(Error::Invalid);
    };
    if size == 0 || size > MAX_PACKAGE_BYTES {
        return Err(Error::Invalid);
    }
    progress(0, Some(size as u64));
    let mut bytes = Vec::new();
    let mut rate = DownloadRate {
        since: tokio::time::Instant::now(),
        bytes: 0,
    };
    loop {
        match receive(connection).await? {
            Frame::Chunk { offset, data } => {
                let chunk = decode_chunk(bytes.len(), size, offset, &data)?;
                progress(chunk.len(), Some(size as u64));
                bytes.extend_from_slice(&chunk);
                rate.check(bytes.len())?;
            }
            Frame::Complete if bytes.len() == size => {
                send(connection, &Frame::Received).await?;
                return Ok(bytes);
            }
            _ => return Err(Error::Invalid),
        }
    }
}

fn decode_chunk(received: usize, size: usize, offset: usize, data: &str) -> Result<Vec<u8>> {
    if offset != received || data.len() > CHUNK_BYTES.div_ceil(3) * 4 {
        return Err(Error::Invalid);
    }
    let bytes = STANDARD.decode(data).map_err(|_| Error::Invalid)?;
    if bytes.is_empty() || bytes.len() > CHUNK_BYTES || received.saturating_add(bytes.len()) > size
    {
        return Err(Error::Invalid);
    }
    Ok(bytes)
}

pub(super) async fn seed(
    connection: &Connection,
    cache: &Arc<Cache>,
    artifact: &str,
) -> Result<()> {
    let first = match opened(connection).await? {
        Some(frame) => frame,
        None => receive(connection).await?,
    };
    let Frame::Get {
        artifact: requested,
    } = first
    else {
        return Err(Error::Invalid);
    };
    if requested != artifact {
        return Err(Error::Invalid);
    }
    let bytes = cache.read(artifact).await?;
    send(connection, &Frame::Header { size: bytes.len() }).await?;
    // Keep consuming route events while sending, so the bounded event queue cannot stall the engine.
    tokio::try_join!(upload(connection, &bytes), wait_for_receipt(connection))?;
    Ok(())
}

async fn upload(connection: &Connection, bytes: &[u8]) -> Result<()> {
    let started = tokio::time::Instant::now();
    for (index, chunk) in bytes.chunks(CHUNK_BYTES).enumerate() {
        let offset = index * CHUNK_BYTES;
        send(
            connection,
            &Frame::Chunk {
                offset,
                data: STANDARD.encode(chunk),
            },
        )
        .await?;
        let elapsed =
            Duration::from_secs_f64((offset + chunk.len()) as f64 / UPLOAD_BYTES_PER_SECOND as f64);
        tokio::time::sleep_until(started + elapsed).await;
    }
    send(connection, &Frame::Complete).await
}

async fn wait_for_receipt(connection: &Connection) -> Result<()> {
    loop {
        match connection.receive().await {
            Some(Event::Data { text }) => {
                return match serde_json::from_str::<Frame>(&text) {
                    Ok(Frame::Received) => Ok(()),
                    _ => Err(Error::Invalid),
                }
            }
            Some(Event::Closed | Event::Open) | None => {
                eprintln!("update seed stream closed or restarted");
                return Err(Error::Unavailable);
            }
            Some(Event::Status { route }) if !route.direct => {
                eprintln!("update seed direct route lost");
                return Err(Error::Unavailable);
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn slow_peers_are_rejected_without_waiting_for_the_full_transfer_deadline() {
        let mut slow = DownloadRate {
            since: tokio::time::Instant::now() - RATE_WINDOW,
            bytes: 0,
        };
        assert!(slow.check(1).is_err());
        let mut fast = DownloadRate {
            since: tokio::time::Instant::now() - RATE_WINDOW,
            bytes: 0,
        };
        assert!(fast
            .check(UPLOAD_BYTES_PER_SECOND * RATE_WINDOW.as_secs() as usize)
            .is_ok());
    }

    #[test]
    fn rejects_reordered_oversized_empty_and_truncated_chunks() {
        let data = STANDARD.encode(b"package");
        assert_eq!(decode_chunk(0, 7, 0, &data).unwrap(), b"package");
        assert!(decode_chunk(1, 7, 0, &data).is_err());
        assert!(decode_chunk(0, 6, 0, &data).is_err());
        assert!(decode_chunk(0, 7, 0, "").is_err());
        assert!(
            decode_chunk(0, usize::MAX, 0, &STANDARD.encode(vec![0; CHUNK_BYTES + 1])).is_err()
        );
        assert!(decode_chunk(0, 7, 0, "not base64").is_err());
    }
}
