//! Independent file stream on the authenticated, direct-only userspace network.
//! Records remain encrypted; neither JSON nor the chat delivery queue carries file bytes.
#[cfg(test)]
mod android_fixture;
#[cfg(test)]
mod tests;
mod wire;

use std::{sync::Arc, time::Duration};

use easytier::instance::factory::NativeCoreInstance;
use easytier_core::gateway::DataPlaneTcpStream;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{mpsc, oneshot, watch, Mutex},
};

use crate::{Error, Event, Result, RouteStatus};

const BULK_PORT: u16 = 47778;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);
const RETRY_DELAY: Duration = Duration::from_secs(1);
const RECEIVE_RECORDS: usize = 16;

struct Write {
    bytes: Vec<u8>,
    completed: oneshot::Sender<Result<()>>,
}

#[derive(Clone)]
struct Active {
    generation: u64,
    sender: mpsc::Sender<Write>,
}

pub(crate) struct Bulk {
    active: watch::Sender<Option<Active>>,
    records: mpsc::Sender<Vec<u8>>,
    received: Mutex<mpsc::Receiver<Vec<u8>>>,
}

impl Bulk {
    pub fn new() -> Arc<Self> {
        let (records, received) = mpsc::channel(RECEIVE_RECORDS);
        Arc::new(Self {
            active: watch::channel(None).0,
            records,
            received: Mutex::new(received),
        })
    }

    pub async fn send(&self, generation: u64, bytes: Vec<u8>) -> Result<()> {
        wire::validate_batch(&bytes)?;
        let active = self.active.borrow().clone().ok_or(Error::Unavailable)?;
        if active.generation != generation {
            return Err(Error::Closed);
        }
        let (completed, result) = oneshot::channel();
        // One in-flight write and one queued batch per connection; JS also awaits each batch.
        active
            .sender
            .try_send(Write { bytes, completed })
            .map_err(|_| Error::Unavailable)?;
        tokio::time::timeout(WRITE_TIMEOUT, result)
            .await
            .map_err(|_| Error::Unavailable)?
            .map_err(|_| Error::Closed)?
    }

    pub async fn receive(&self) -> Option<Vec<u8>> {
        self.received.lock().await.recv().await
    }

    pub fn close(&self) {
        self.active.send_replace(None);
    }

    pub async fn run(
        &self,
        instance: &Arc<NativeCoreInstance>,
        desktop: bool,
        output: (&watch::Receiver<RouteStatus>, &mpsc::Sender<Event>),
    ) -> Result<()> {
        let (route, events) = output;
        let mut generation = 0;
        loop {
            if let Ok(mut stream) = connect(instance, desktop, route.clone()).await {
                let handshake =
                    tokio::time::timeout(CONNECT_TIMEOUT, wire::handshake(&mut stream)).await;
                if matches!(handshake, Ok(Ok(()))) && route.borrow().direct {
                    generation += 1;
                    self.session(stream, generation, (route.clone(), events))
                        .await?;
                }
            }
            tokio::time::sleep(RETRY_DELAY).await;
        }
    }

    async fn session(
        &self,
        stream: DataPlaneTcpStream,
        generation: u64,
        output: (watch::Receiver<RouteStatus>, &mpsc::Sender<Event>),
    ) -> Result<()> {
        let (route, events) = output;
        let (sender, incoming) = mpsc::channel(1);
        self.active
            .send_replace(Some(Active { generation, sender }));
        events
            .send(Event::Bulk { generation })
            .await
            .map_err(|_| Error::Closed)?;
        let (read, write) = tokio::io::split(stream);
        // A route loss closes this stream and drops its queued writes. No batch is replayed.
        let _disconnected = tokio::try_join!(
            read_records(read, &self.records),
            write_batches(write, incoming),
            direct_lost(route)
        );
        self.close();
        events
            .send(Event::Bulk { generation: 0 })
            .await
            .map_err(|_| Error::Closed)
    }
}

async fn connect(
    instance: &Arc<NativeCoreInstance>,
    desktop: bool,
    mut route: watch::Receiver<RouteStatus>,
) -> Result<DataPlaneTcpStream> {
    if desktop {
        let mut listener = instance
            .data_plane_tcp_bind(BULK_PORT, CONNECT_TIMEOUT)
            .await
            .map_err(|_| Error::Unavailable)?;
        return Ok(listener.accept().await?.0);
    }
    while !route.borrow().direct {
        route.changed().await.map_err(|_| Error::Closed)?;
    }
    let address = std::net::SocketAddr::from(([10, 253, 0, 1], BULK_PORT));
    instance
        .data_plane_tcp_connect(address, CONNECT_TIMEOUT)
        .await
        .map_err(|_| Error::Unavailable)
}

async fn direct_lost(mut route: watch::Receiver<RouteStatus>) -> Result<()> {
    loop {
        if !route.borrow().direct {
            return Err(Error::Unavailable);
        }
        route.changed().await.map_err(|_| Error::Closed)?;
    }
}

async fn read_records(
    mut read: impl AsyncReadExt + Unpin,
    output: &mpsc::Sender<Vec<u8>>,
) -> Result<()> {
    loop {
        let record = wire::read_record(&mut read).await?;
        output.send(record).await.map_err(|_| Error::Closed)?;
    }
}

async fn write_batches(
    mut write: impl AsyncWriteExt + Unpin,
    mut input: mpsc::Receiver<Write>,
) -> Result<()> {
    while let Some(batch) = input.recv().await {
        let result = write.write_all(&batch.bytes[5..]).await.map_err(Error::Io);
        let failed = result.is_err();
        // A canceled caller no longer needs an acknowledgement; its epoch rejects late records.
        let _caller_gone = batch.completed.send(result);
        if failed {
            return Err(Error::Closed);
        }
    }
    Err(Error::Closed)
}
