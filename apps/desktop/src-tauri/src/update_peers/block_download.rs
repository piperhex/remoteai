//! Bounded request pipelines, continuing discovery and independently verified checkpoints.
use super::{
    block_plan::{request_window, Plan},
    block_protocol::Reader,
    cache::Artifact,
    checkpoint::Checkpoint,
    origin_blocks::Origin,
    reporting::{Report, Source as ReportSource},
    signaling::Lease,
    snapshot::BLOCK_BYTES,
    Error, Result, Service, MAX_DOWNLOAD_PEERS,
};
use futures_util::{future::BoxFuture, stream::FuturesUnordered, FutureExt, StreamExt};
use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tokio::{sync::mpsc, time::Instant};

const ORIGIN: usize = MAX_DOWNLOAD_PEERS;
const MIRROR: usize = ORIGIN + 1;
const SOURCES: usize = ORIGIN + 2;
const REFILL_INTERVAL: Duration = Duration::from_secs(12);
const BLOCK_TIMEOUT: Duration = Duration::from_secs(25);
const STALL_TIMEOUT: Duration = Duration::from_secs(75);

enum Source {
    Peer { reader: Reader, window: usize },
    Http { origin: Origin, size: usize },
}

impl Source {
    fn size(&self) -> usize {
        match self {
            Self::Peer { reader, .. } => reader.manifest.size,
            Self::Http { size, .. } => *size,
        }
    }
    fn window(&self) -> usize {
        match self {
            Self::Peer { window, .. } => *window,
            Self::Http { .. } => super::snapshot::MAX_REQUESTS,
        }
    }
    async fn transfer(
        &mut self,
        indices: Vec<usize>,
        report: (usize, mpsc::Sender<Block>),
    ) -> Result<()> {
        let started = Instant::now();
        if let Self::Peer { reader, .. } = self {
            reader.request(&indices).await?;
        }
        let mut received = 0;
        for index in indices {
            let operation = async {
                match self {
                    Self::Peer { reader, .. } => reader.block(index).await,
                    Self::Http { origin, size } => {
                        origin
                            .block(
                                index * BLOCK_BYTES,
                                BLOCK_BYTES.min(*size - index * BLOCK_BYTES),
                                *size,
                            )
                            .await
                    }
                }
            };
            let bytes = tokio::time::timeout(BLOCK_TIMEOUT, operation)
                .await
                .map_err(|_| Error::Unavailable)??;
            received += bytes.len();
            report
                .1
                .send(Block {
                    source: report.0,
                    index,
                    bytes,
                })
                .await
                .map_err(|_| Error::Unavailable)?;
        }
        if let Self::Peer { reader, window } = self {
            *window = request_window(received, started.elapsed(), reader.manifest.request_window);
        }
        Ok(())
    }
}

struct Block {
    source: usize,
    index: usize,
    bytes: Vec<u8>,
}
type Job<'a> = BoxFuture<'a, (usize, Result<Source>)>;
type Discovery<'a> = Option<BoxFuture<'a, Result<Vec<Lease>>>>;

struct Download<'a> {
    report: &'a mut Report,
    artifact: &'a Artifact,
    service: &'a Service,
    leases: &'a mut Vec<Lease>,
    slots: Vec<Option<usize>>,
    ready: Vec<Option<Source>>,
    jobs: FuturesUnordered<Job<'a>>,
    plan: Option<Plan>,
    destination: Option<Arc<Checkpoint>>,
    origin_attempts: usize,
}

#[cfg(test)]
pub(super) async fn download(
    leases: &mut Vec<Lease>,
    artifact: &Artifact,
    service: &Service,
    progress: impl FnMut(usize, Option<u64>),
) -> Result<Vec<u8>> {
    download_recorded(
        leases,
        artifact,
        service,
        (&mut Report::new(&artifact.id), progress),
    )
    .await
}

pub(super) async fn download_recorded(
    leases: &mut Vec<Lease>,
    artifact: &Artifact,
    service: &Service,
    reporting: (&mut Report, impl FnMut(usize, Option<u64>)),
) -> Result<Vec<u8>> {
    let (report, mut progress) = reporting;
    let (sender, blocks) = mpsc::channel(16);
    let mut state = Download::new(leases, artifact, service, report);
    state.start();
    if let Err(error) = receive_blocks(&mut state, &mut progress, &sender, blocks).await {
        if let Some(destination) = &state.destination {
            if let Err(flush_error) = destination.flush().await {
                eprintln!("could not checkpoint failed update download: {flush_error}");
            }
        }
        return Err(error);
    }
    state.finish().await
}

async fn receive_blocks(
    state: &mut Download<'_>,
    progress: &mut impl FnMut(usize, Option<u64>),
    sender: &mpsc::Sender<Block>,
    mut blocks: mpsc::Receiver<Block>,
) -> Result<()> {
    let mut next_refill = Instant::now() + REFILL_INTERVAL;
    let mut discovery: Discovery<'_> = None;
    let mut last_progress = Instant::now();
    loop {
        tokio::select! {
            biased;
            Some(block) = blocks.recv() => {
                if state.accept_block(block, progress).await? { last_progress = Instant::now(); }
            }
            Some((source, result)) = state.jobs.next(), if !state.jobs.is_empty() => {
                state.accept_source(source, result, progress).await?;
            }
            found = discover(&mut discovery), if discovery.is_some() => {
                if let Ok(leases) = found { state.add_peers(leases); }
                discovery = None;
            }
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
        if state.complete() {
            return Ok(());
        }
        if Instant::now() >= next_refill
            && discovery.is_none()
            && state.slots.iter().any(Option::is_none)
        {
            discovery = Some(state.service.find_peers(&state.artifact.id).boxed());
            next_refill = Instant::now() + REFILL_INTERVAL;
        }
        state.schedule(sender);
        if last_progress.elapsed() > STALL_TIMEOUT
            || (state.jobs.is_empty()
                && state.ready.iter().all(Option::is_none)
                && state.service.broker.borrow().is_none())
        {
            return Err(Error::Unavailable);
        }
    }
}

async fn discover(discovery: &mut Discovery<'_>) -> Result<Vec<Lease>> {
    match discovery {
        Some(pending) => pending.await,
        None => std::future::pending().await,
    }
}

impl<'a> Download<'a> {
    fn new(
        leases: &'a mut Vec<Lease>,
        artifact: &'a Artifact,
        service: &'a Service,
        report: &'a mut Report,
    ) -> Self {
        Self {
            report,
            artifact,
            service,
            leases,
            slots: vec![None; MAX_DOWNLOAD_PEERS],
            ready: (0..SOURCES).map(|_| None).collect(),
            jobs: FuturesUnordered::new(),
            plan: None,
            destination: None,
            origin_attempts: 0,
        }
    }

    fn start(&mut self) {
        for index in 0..self.leases.len().min(MAX_DOWNLOAD_PEERS) {
            self.start_peer(index, index);
        }
        self.start_origin();
        let mirror = self
            .service
            .mirror_base
            .borrow()
            .as_ref()
            .and_then(|base| super::mirror::package_url(base, &self.artifact.url));
        if let Some(url) = mirror {
            self.start_http(MIRROR, url, 0);
        }
    }

    fn start_peer(&mut self, slot: usize, index: usize) {
        self.slots[slot] = Some(index);
        let connection = self.leases[index].connection.clone();
        let artifact = self.artifact.id.clone();
        self.jobs.push(
            async move {
                let result = Reader::open(connection, &artifact).await.map(|reader| {
                    let window = reader.manifest.request_window.min(2);
                    Source::Peer { reader, window }
                });
                (slot, result)
            }
            .boxed(),
        );
    }

    fn start_origin(&mut self) {
        self.origin_attempts += 1;
        let url = self.artifact.url.clone();
        let delay = if self.origin_attempts == 1 && self.leases.is_empty() {
            0
        } else {
            2
        };
        self.start_http(ORIGIN, url, delay);
    }

    fn start_http(&mut self, slot: usize, url: String, delay: u64) {
        self.jobs.push(
            async move {
                tokio::time::sleep(Duration::from_secs(delay)).await;
                let result = async {
                    let origin = Origin::new(&url)?;
                    let size = origin.size().await?;
                    Ok(Source::Http { origin, size })
                }
                .await;
                (slot, result)
            }
            .boxed(),
        );
    }

    fn add_peers(&mut self, leases: Vec<Lease>) {
        for lease in leases {
            if lease.protocol < 2 {
                continue;
            }
            let Some(slot) = self.slots.iter().position(Option::is_none) else {
                break;
            };
            // A slot owns one lease; completed/failed engines must not accumulate through repeated refreshes.
            if slot < self.leases.len() {
                self.leases[slot] = lease;
            } else {
                self.leases.push(lease);
            }
            self.start_peer(slot, slot);
        }
    }

    async fn accept_source(
        &mut self,
        source: usize,
        result: Result<Source>,
        progress: &mut impl FnMut(usize, Option<u64>),
    ) -> Result<()> {
        let worker = match result {
            Ok(worker) if self.valid_size(worker.size()) => worker,
            result => {
                let error = result.err().unwrap_or(Error::Invalid);
                self.report.failure(
                    report_source(source),
                    if self.plan.is_some() {
                        "transfer"
                    } else {
                        "connect"
                    },
                    &error,
                );
                self.failed(source);
                return Ok(());
            }
        };
        if self.plan.is_none() {
            let size = worker.size();
            let (destination, done) = Checkpoint::open(
                self.service.cache.partial_directory(),
                self.artifact.id.clone(),
                size,
            )
            .await?;
            let mut plan = Plan::new(size, SOURCES);
            plan.completed = done.iter().filter(|done| **done).count();
            plan.done = done;
            let restored = (0..plan.done.len())
                .filter(|&i| plan.done[i])
                .map(|i| plan.length(i))
                .sum();
            progress(restored, Some(size as u64));
            self.plan = Some(plan);
            self.destination = Some(destination);
        }
        self.ready[source] = Some(worker);
        Ok(())
    }

    fn valid_size(&self, size: usize) -> bool {
        size > 0
            && size <= super::MAX_PACKAGE_BYTES
            && (self.artifact.size == 0 || size == self.artifact.size)
            && self.plan.as_ref().is_none_or(|plan| plan.size == size)
    }

    fn failed(&mut self, source: usize) {
        let metrics = &self.service.policy.metrics;
        metrics.failures.fetch_add(1, Ordering::Relaxed);
        if let Some(plan) = &mut self.plan {
            metrics
                .retries
                .fetch_add(plan.busy[source].len() as u64, Ordering::Relaxed);
            plan.busy[source].clear();
        }
        if source < MAX_DOWNLOAD_PEERS {
            if let Some(index) = self.slots[source].take() {
                self.leases[index].failed();
            }
        } else if source == ORIGIN && self.origin_attempts < 3 {
            self.start_origin();
        }
    }

    async fn accept_block(
        &mut self,
        block: Block,
        progress: &mut impl FnMut(usize, Option<u64>),
    ) -> Result<bool> {
        let plan = self.plan.as_mut().ok_or(Error::Invalid)?;
        let length = block.bytes.len();
        if !plan.done[block.index] {
            self.destination
                .as_ref()
                .ok_or(Error::Invalid)?
                .write(block.index, block.bytes)
                .await?;
        }
        if !plan.finish(block.source, block.index) {
            return Ok(false);
        }
        let metrics = &self.service.policy.metrics;
        let counter = if block.source >= ORIGIN {
            &metrics.origin_bytes
        } else {
            &metrics.peer_bytes
        };
        counter.fetch_add(length as u64, Ordering::Relaxed);
        self.report.accepted(report_source(block.source), length);
        progress(length, Some(plan.size as u64));
        Ok(true)
    }

    fn schedule(&mut self, sender: &mpsc::Sender<Block>) {
        let Some(plan) = &mut self.plan else { return };
        for slot in 0..SOURCES {
            let Some(worker) = &self.ready[slot] else {
                continue;
            };
            let indices = plan.claim(slot, worker.window(), slot < ORIGIN);
            let duplicated = indices
                .iter()
                .filter(|index| {
                    plan.busy
                        .iter()
                        .flatten()
                        .filter(|(busy, _)| busy == *index)
                        .count()
                        > 1
                })
                .count();
            self.service
                .policy
                .metrics
                .retries
                .fetch_add(duplicated as u64, Ordering::Relaxed);
            if indices.is_empty() {
                continue;
            }
            let Some(mut worker) = self.ready[slot].take() else {
                continue;
            };
            let report = (slot, sender.clone());
            self.jobs.push(
                async move {
                    let result = worker.transfer(indices, report).await.map(|()| worker);
                    (slot, result)
                }
                .boxed(),
            );
        }
    }

    fn complete(&self) -> bool {
        self.plan
            .as_ref()
            .is_some_and(|plan| plan.completed == plan.done.len())
    }

    async fn finish(self) -> Result<Vec<u8>> {
        let size = self.plan.ok_or(Error::Invalid)?.size;
        self.destination.ok_or(Error::Invalid)?.finish(size).await
    }
}

fn report_source(source: usize) -> ReportSource {
    match source {
        ORIGIN => ReportSource::Origin,
        MIRROR => ReportSource::Server,
        _ => ReportSource::Peer,
    }
}
