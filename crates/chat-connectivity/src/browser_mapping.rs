//! A browser-only SOCKS5 endpoint for active TCP port mappings. Never resolve a peer-supplied name.
use std::{
    collections::{BTreeMap, BTreeSet},
    net::{Ipv4Addr, SocketAddr},
    sync::{Arc, RwLock},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::watch,
    task::{JoinHandle, JoinSet},
    time::timeout,
};

use crate::{Error, Result};

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserRoute {
    pub domain: String,
    pub port: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<SocketAddr>,
}

impl BrowserRoute {
    pub fn valid_set(routes: &BTreeSet<Self>) -> bool {
        let mut addresses = BTreeSet::new();
        routes.len() <= 256
            && routes
                .iter()
                .all(|r| r.valid() && addresses.insert((&r.domain, r.port)))
    }

    pub fn valid(&self) -> bool {
        let domain = &self.domain;
        self.port != 0
            && domain.len() <= 253
            && (domain == "localhost"
                || domain
                    .rsplit_once('.')
                    .is_some_and(|(_, tld)| tld.starts_with(|c: char| c.is_ascii_lowercase())))
            && self
                .target
                .is_none_or(|target| !target.ip().is_unspecified() && target.port() != 0)
            && domain.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            })
    }
}

type Routes = Arc<RwLock<BTreeMap<BrowserRoute, watch::Sender<()>>>>;

/// Revoking a route closes only its streams. The loopback proxy port stays stable across edits.
pub struct BrowserMappingProxy {
    port: u16,
    routes: Routes,
    worker: JoinHandle<()>,
}

impl BrowserMappingProxy {
    pub async fn start(routes: BTreeSet<BrowserRoute>) -> Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let port = listener.local_addr()?.port();
        let active = Routes::default();
        let proxy = Self {
            port,
            routes: active.clone(),
            worker: tokio::spawn(serve(listener, active)),
        };
        proxy.configure(routes)?;
        Ok(proxy)
    }
    pub fn configure(&self, routes: BTreeSet<BrowserRoute>) -> Result<()> {
        if !BrowserRoute::valid_set(&routes) {
            return Err(Error::Invalid);
        }
        let mut active = self.routes.write().map_err(|_| Error::Closed)?;
        active.retain(|key, _| routes.contains(key));
        for route in routes {
            active.entry(route).or_insert_with(|| watch::channel(()).0);
        }
        Ok(())
    }
    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for BrowserMappingProxy {
    fn drop(&mut self) {
        self.worker.abort();
    }
}

async fn serve(listener: TcpListener, routes: Routes) {
    let mut streams = JoinSet::new();
    loop {
        tokio::select! {
            _ = streams.join_next(), if !streams.is_empty() => {}
            incoming = listener.accept() => {
                let Ok((mut browser, _)) = incoming else { break };
                if streams.len() >= 64 { continue; }
                let routes = routes.clone();
                streams.spawn(async move {
                    if let Ok(Ok((mut target, mut revoked))) = timeout(Duration::from_secs(10), connect(&mut browser, &routes)).await {
                        tokio::select! {
                            biased;
                            _ = revoked.changed() => {}
                            _ = tokio::io::copy_bidirectional(&mut browser, &mut target) => {}
                        }
                    }
                });
            }
        }
    }
}

async fn connect(
    browser: &mut TcpStream,
    routes: &Routes,
) -> Result<(TcpStream, watch::Receiver<()>)> {
    let mut greeting = [0; 2];
    browser.read_exact(&mut greeting).await?;
    if greeting[0] != 5 || greeting[1] == 0 {
        return Err(Error::Invalid);
    }
    let mut methods = vec![0; usize::from(greeting[1])];
    browser.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        browser.write_all(&[5, 255]).await?;
        return Err(Error::Invalid);
    }
    browser.write_all(&[5, 0]).await?;
    let mut header = [0; 5];
    browser.read_exact(&mut header).await?;
    if header[..4] != [5, 1, 0, 3] {
        return reject(browser).await;
    }
    let mut name = vec![0; usize::from(header[4])];
    browser.read_exact(&mut name).await?;
    let port = browser.read_u16().await?;
    let domain = String::from_utf8(name)
        .map_err(|_| Error::Invalid)?
        .to_ascii_lowercase();
    let destination = routes
        .read()
        .map_err(|_| Error::Closed)?
        .iter()
        .find(|(route, _)| route.domain == domain && route.port == port)
        .map(|(route, active)| {
            (
                route
                    .target
                    .unwrap_or_else(|| (Ipv4Addr::LOCALHOST, port).into()),
                active.subscribe(),
            )
        });
    let Some((target, revoked)) = destination else {
        return reject(browser).await;
    };
    let target = TcpStream::connect(target).await?;
    browser.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
    Ok((target, revoked))
}

async fn reject<T>(browser: &mut TcpStream) -> Result<T> {
    browser.write_all(&[5, 2, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
    Err(Error::Invalid)
}

#[cfg(test)]
#[path = "browser_mapping_tests.rs"]
mod tests;
