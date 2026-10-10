use std::{
    collections::HashMap,
    sync::{Arc, Weak},
    time::Duration,
};

use easytier::instance::factory::{create_native_instance, NativeCoreInstance};
use easytier_core::gateway::DataPlaneTcpStream;
use serde::Serialize;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{mpsc, watch, Mutex},
};

use crate::{
    config::CHAT_PORT,
    diagnostics::{self, Snapshot, Stage},
    route::{self, RouteStatus},
    Config, Error, Result,
};

const QUEUE_MESSAGES: usize = 8;
const MAX_FRAME: usize = 128 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_MEDIA_VIEWS: usize = 2;

#[cfg(test)]
#[path = "connection_tests.rs"]
mod tests;

struct EngineControls {
    canceled: watch::Receiver<bool>,
    expiry: watch::Receiver<u64>,
    engine: watch::Sender<Option<Weak<NativeCoreInstance>>>,
    route: watch::Sender<RouteStatus>,
    bulk: Option<Arc<crate::bulk::Bulk>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Event {
    Diagnostic {
        stage: Stage,
        snapshot: Snapshot,
    },
    Punch {
        report: easytier_core::connectivity::hole_punch::PunchReport,
    },
    Status {
        route: RouteStatus,
    },
    Open,
    Bulk {
        generation: u64,
    },
    Data {
        text: String,
    },
    Closed,
}

/// One bounded, authenticated stream. Dropping it cancels the engine and its mapping leases.
pub struct Connection {
    sender: mpsc::Sender<String>,
    events: Mutex<mpsc::Receiver<Event>>,
    cancel: watch::Sender<bool>,
    deadline: watch::Sender<u64>,
    engine: watch::Receiver<Option<Weak<NativeCoreInstance>>>,
    route: watch::Receiver<RouteStatus>,
    desktop: bool,
    media: Mutex<HashMap<String, Arc<crate::MediaProxy>>>,
    bulk: Option<Arc<crate::bulk::Bulk>>,
}

impl Connection {
    pub fn start(config: Config) -> Result<Arc<Self>> {
        Self::start_with_bulk(config, false)
    }

    /// Opt in only when the platform can consume raw file records without a JSON bridge.
    pub fn start_with_bulk(config: Config, binary_bulk: bool) -> Result<Arc<Self>> {
        config.validate()?;
        let (sender, incoming) = mpsc::channel(QUEUE_MESSAGES);
        let (events, receiver) = mpsc::channel(QUEUE_MESSAGES);
        let cancel = watch::channel(false).0;
        let deadline = watch::channel(config.expires_at).0;
        let canceled = cancel.subscribe();
        let expiry = deadline.subscribe();
        let desktop = config.desktop;
        let (engine_tx, engine) = watch::channel(None);
        let (route_tx, route) = watch::channel(RouteStatus::default());
        let terminated = cancel.clone();
        let bulk = binary_bulk.then(crate::bulk::Bulk::new);
        let running_bulk = bulk.clone();
        tokio::spawn(async move {
            // All exit paths close the event stream, including engine initialization errors.
            if serve(
                config,
                incoming,
                &events,
                EngineControls {
                    canceled,
                    expiry,
                    engine: engine_tx,
                    route: route_tx,
                    bulk: running_bulk,
                },
            )
            .await
            .is_err()
            {
                diagnostics::report(&events, Stage::EngineFailed, Snapshot::default());
            }
            terminated.send_replace(true);
            diagnostics::report(&events, Stage::Stopped, Snapshot::default());
            // A stopped/suspended frontend must not prevent native resource cleanup.
            let _delivered =
                tokio::time::timeout(Duration::from_secs(1), events.send(Event::Closed)).await;
        });
        Ok(Arc::new(Self {
            sender,
            events: Mutex::new(receiver),
            cancel,
            deadline,
            engine,
            route,
            desktop,
            media: Mutex::default(),
            bulk,
        }))
    }

    pub async fn send(&self, text: String) -> Result<()> {
        if self.is_closed() {
            return Err(Error::Closed);
        }
        if text.is_empty() || text.len() > MAX_FRAME {
            return Err(Error::Invalid);
        }
        tokio::time::timeout(CONNECT_TIMEOUT, self.sender.send(text))
            .await
            .map_err(|_| Error::Unavailable)?
            .map_err(|_| Error::Closed)
    }

    pub async fn receive(&self) -> Option<Event> {
        self.events.lock().await.recv().await
    }

    pub fn close(&self) {
        self.cancel.send_replace(true);
    }
    pub fn is_closed(&self) -> bool {
        self.sender.is_closed() || *self.cancel.borrow()
    }

    /// The generation belongs to this native stream, independent of a file transfer's epoch.
    pub async fn send_bulk(&self, generation: u64, bytes: Vec<u8>) -> Result<()> {
        if self.is_closed() || !self.desktop {
            return Err(Error::Closed);
        }
        self.bulk
            .as_ref()
            .ok_or(Error::Unavailable)?
            .send(generation, bytes)
            .await
    }

    /// Consumed by a native download worker, never the JSON event poller.
    pub async fn receive_bulk(&self) -> Option<Vec<u8>> {
        if self.is_closed() || self.desktop {
            return None;
        }
        let bulk = self.bulk.as_ref()?;
        let mut canceled = self.cancel.subscribe();
        tokio::select! {
            _ = canceled.changed() => None,
            record = bulk.receive() => record,
        }
    }

    /// Reuse this authenticated engine; media never crosses the chat stream or JavaScript.
    pub async fn open_media(&self, id: &str) -> Result<crate::MediaEndpoint> {
        if self.is_closed() {
            return Err(Error::Closed);
        }
        if id.is_empty()
            || id.len() > 100
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err(Error::Invalid);
        }
        let mut engine = self.engine.clone();
        let instance = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Some(instance) = engine.borrow().as_ref().and_then(Weak::upgrade) {
                    return Ok::<_, Error>(instance);
                }
                engine.changed().await.map_err(|_| Error::Closed)?;
            }
        })
        .await
        .map_err(|_| Error::Unavailable)??;
        let mut media = self.media.lock().await;
        if let Some(proxy) = media.get(id) {
            return Ok(proxy.endpoint());
        }
        if self.is_closed() || media.len() >= MAX_MEDIA_VIEWS {
            return Err(Error::Closed);
        }
        let proxy = crate::MediaProxy::start(
            instance,
            self.desktop,
            self.route.clone(),
            self.cancel.subscribe(),
        )
        .await?;
        let endpoint = proxy.endpoint();
        media.insert(id.into(), proxy);
        Ok(endpoint)
    }

    pub async fn media_status(&self, id: &str) -> Result<RouteStatus> {
        if self.is_closed() {
            return Err(Error::Closed);
        }
        self.media
            .lock()
            .await
            .get(id)
            .map(|proxy| proxy.status())
            .ok_or(Error::Closed)
    }
    pub async fn close_media(&self, id: &str) {
        if let Some(proxy) = self.media.lock().await.remove(id) {
            proxy.close();
        }
    }

    /// Only an authenticated signaling renewal may extend the lease.
    pub fn renew(&self, expires_at: u64) -> Result<()> {
        if expires_at <= crate::lease::now_ms() || *self.cancel.borrow() {
            return Err(Error::Closed);
        }
        self.deadline.send_replace(expires_at);
        Ok(())
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.close();
    }
}

async fn serve(
    mut config: Config,
    incoming: mpsc::Receiver<String>,
    events: &mpsc::Sender<Event>,
    controls: EngineControls,
) -> Result<()> {
    let EngineControls {
        mut canceled,
        expiry,
        engine: engine_tx,
        route: route_tx,
        bulk,
    } = controls;
    let network = tokio::select! {
        result = crate::network::prepare(&mut config) => result?,
        _ = canceled.changed() => return Ok(()),
        _ = crate::lease::expired(expiry.clone()) => return Ok(()),
    };
    let core = config.core()?;
    network.apply(&core);
    let engine = tokio::task::spawn_blocking(move || create_native_instance(core))
        .await
        .map_err(|_| Error::Unavailable)?
        .map_err(|_| Error::Unavailable)?;
    let punch_events = engine.udp_punch_diagnostics();
    engine_tx.send_replace(Some(Arc::downgrade(&engine)));
    let result = tokio::select! {
        _ = canceled.changed() => Ok(()),
        _ = crate::lease::expired(expiry) => Ok(()),
        result = run(&engine, &config, (incoming, events.clone()), (bulk.as_deref(), route_tx.subscribe())) => result,
        _ = diagnostics::monitor(&engine, config.remote_name(), events, punch_events) => Err(Error::Closed),
        _ = monitor_route(&engine, config.remote_name(), (&route_tx, &network)) => Err(Error::Closed),
        _ = network.changed() => Err(Error::Unavailable),
    };
    engine_tx.send_replace(None);
    route_tx.send_replace(RouteStatus::default());
    if let Some(bulk) = bulk {
        bulk.close();
    }
    engine.stop().await;
    result
}

async fn monitor_route(
    engine: &NativeCoreInstance,
    remote: &str,
    output: (&watch::Sender<RouteStatus>, &crate::network::Plan),
) {
    let mut timer = tokio::time::interval(Duration::from_millis(500));
    loop {
        timer.tick().await;
        let status = route::status_with_source(engine, remote, output.1.local_ipv4()).await;
        output.0.send_replace(status);
    }
}

async fn run(
    instance: &Arc<NativeCoreInstance>,
    config: &Config,
    queues: (mpsc::Receiver<String>, mpsc::Sender<Event>),
    files: (Option<&crate::bulk::Bulk>, watch::Receiver<RouteStatus>),
) -> Result<()> {
    let (incoming, events) = queues;
    diagnostics::report(&events, Stage::EngineStart, Snapshot::default());
    instance.start().await.map_err(|_| Error::Unavailable)?;
    if let Some(bulk) = files.0 {
        tokio::select! {
            result = chat_streams(instance, config, (incoming, events.clone()), files.1.clone()) => result,
            result = bulk.run(instance, config.desktop, (&files.1, &events)) => result,
        }
    } else {
        chat_streams(instance, config, (incoming, events), files.1).await
    }
}

async fn chat_streams(
    instance: &Arc<NativeCoreInstance>,
    config: &Config,
    queues: (mpsc::Receiver<String>, mpsc::Sender<Event>),
    route: watch::Receiver<RouteStatus>,
) -> Result<()> {
    let (mut incoming, events) = queues;
    loop {
        diagnostics::report(&events, Stage::StreamConnect, Snapshot::default());
        let connected = connect(instance, config).await;
        let Ok(stream) = connected else {
            diagnostics::report(&events, Stage::StreamFailed, Snapshot::default());
            tokio::time::sleep(Duration::from_secs(1)).await;
            continue;
        };
        if !route::status(instance, config.remote_name()).await.direct
            || !wait_for_direct_route(route.clone()).await
        {
            continue;
        }
        events.send(Event::Open).await.map_err(|_| Error::Closed)?;
        diagnostics::report(&events, Stage::StreamOpen, Snapshot::default());
        let _disconnected = pump(stream, (&mut incoming, &events), route.clone()).await;
        events
            .send(Event::Status {
                route: RouteStatus::default(),
            })
            .await
            .map_err(|_| Error::Closed)?;
        if incoming.is_closed() {
            return Ok(());
        }
    }
}

async fn wait_for_direct_route(mut route: watch::Receiver<RouteStatus>) -> bool {
    // The stream monitor consumes this watch, which can lag the engine's fresh route snapshot.
    // Announcing Open before it catches up makes the monitor immediately discard a healthy socket.
    matches!(
        tokio::time::timeout(CONNECT_TIMEOUT, async {
            while !route.borrow_and_update().direct {
                route.changed().await.map_err(|_| Error::Closed)?;
            }
            Ok::<_, Error>(())
        })
        .await,
        Ok(Ok(()))
    )
}

async fn connect(
    instance: &Arc<NativeCoreInstance>,
    config: &Config,
) -> Result<DataPlaneTcpStream> {
    if config.desktop {
        let mut listener = instance
            .data_plane_tcp_bind(CHAT_PORT, CONNECT_TIMEOUT)
            .await
            .map_err(|_| Error::Unavailable)?;
        let (stream, _) = listener.accept().await?;
        return Ok(stream);
    }
    while !route::status(instance, config.remote_name()).await.direct {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    instance
        .data_plane_tcp_connect(config.remote_address(), CONNECT_TIMEOUT)
        .await
        .map_err(|_| Error::Unavailable)
}

async fn pump(
    stream: DataPlaneTcpStream,
    queues: (&mut mpsc::Receiver<String>, &mpsc::Sender<Event>),
    route: watch::Receiver<RouteStatus>,
) -> Result<()> {
    let (read, write) = tokio::io::split(stream);
    let (incoming, events) = queues;
    // Each I/O future stays alive across health ticks; canceling a partial frame would corrupt framing.
    tokio::try_join!(
        read_frames(read, events),
        write_frames(write, incoming),
        monitor(route, events)
    )?;
    Ok(())
}

async fn monitor(
    mut route: watch::Receiver<RouteStatus>,
    events: &mpsc::Sender<Event>,
) -> Result<()> {
    let mut previous = RouteStatus::default();
    loop {
        let status = route.borrow_and_update().clone();
        if !status.direct {
            return Err(Error::Unavailable);
        }
        if status != previous {
            events
                .send(Event::Status {
                    route: status.clone(),
                })
                .await
                .map_err(|_| Error::Closed)?;
            previous = status;
        }
        route.changed().await.map_err(|_| Error::Closed)?;
    }
}

async fn read_frames(
    mut read: impl AsyncReadExt + Unpin,
    events: &mpsc::Sender<Event>,
) -> Result<()> {
    loop {
        let text = read_frame(&mut read).await?;
        events
            .send(Event::Data { text })
            .await
            .map_err(|_| Error::Closed)?;
    }
}

async fn write_frames(
    mut write: impl AsyncWriteExt + Unpin,
    incoming: &mut mpsc::Receiver<String>,
) -> Result<()> {
    while let Some(text) = incoming.recv().await {
        write.write_u32(text.len() as u32).await?;
        write.write_all(text.as_bytes()).await?;
    }
    Err(Error::Closed)
}

async fn read_frame(read: &mut (impl AsyncReadExt + Unpin)) -> Result<String> {
    let length = read.read_u32().await? as usize;
    if length == 0 || length > MAX_FRAME {
        return Err(Error::Invalid);
    }
    let mut bytes = vec![0; length];
    read.read_exact(&mut bytes).await?;
    String::from_utf8(bytes).map_err(|_| Error::Invalid)
}
