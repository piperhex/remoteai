//! Loopback-only WebRTC adapter to the existing authenticated, direct-only native data plane.
//! TURN framing stays local. DTLS/SRTP/SCTP datagrams travel through EasyTier without JS copies.
mod listener;
mod socket;
#[cfg(test)]
mod socket_tests;
mod tcp;
#[cfg(test)]
mod tests;

use crate::{Error, Result, RouteStatus};
use easytier::instance::factory::NativeCoreInstance;
use rand::RngCore;
use serde::Serialize;
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};
use tokio::{net::UdpSocket, sync::watch};
use turn::{
    auth::{generate_auth_key, AuthHandler},
    server::{
        config::{ConnConfig, ServerConfig},
        Server,
    },
};

const REALM: &str = "csw-native-media";
pub(super) const MAX_ALLOCATIONS: usize = 16;

/// Credentials are usable only on this device and are never sent to the remote viewer.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEndpoint {
    pub urls: Vec<String>,
    pub username: String,
    pub credential: String,
    pub local_address: String,
    pub remote_address: String,
}

/// Owned by one desktop viewer. Closing the chat grant also closes every associated adapter.
pub struct MediaProxy {
    endpoint: MediaEndpoint,
    route: watch::Receiver<RouteStatus>,
    cancel: watch::Sender<bool>,
    parent: watch::Receiver<bool>,
}

#[derive(Clone)]
pub(super) struct Lifetime {
    canceled: watch::Receiver<bool>,
    parent: watch::Receiver<bool>,
}

impl Lifetime {
    pub fn closed(&self) -> bool {
        *self.canceled.borrow()
            || *self.parent.borrow()
            || self.canceled.has_changed().is_err()
            || self.parent.has_changed().is_err()
    }

    pub async fn finished(&mut self) {
        if self.closed() {
            return;
        }
        tokio::select! { _ = self.parent.changed() => {}, _ = self.canceled.changed() => {} }
    }
}

impl MediaProxy {
    pub(crate) async fn start(
        engine: Arc<NativeCoreInstance>,
        desktop: bool,
        route: watch::Receiver<RouteStatus>,
        parent: watch::Receiver<bool>,
    ) -> Result<Arc<Self>> {
        if *parent.borrow() {
            return Err(Error::Closed);
        }
        let cancel = watch::channel(false).0;
        let mut lifetime = Lifetime {
            canceled: cancel.subscribe(),
            parent: parent.clone(),
        };
        let (server, endpoint) = prepare(engine, desktop, route.clone(), lifetime.clone()).await?;
        tokio::spawn(async move {
            lifetime.finished().await;
            if let Err(error) = server.close().await {
                eprintln!("native media adapter cleanup failed: {error}");
            }
        });
        Ok(Arc::new(Self {
            endpoint,
            route,
            cancel,
            parent,
        }))
    }

    pub fn endpoint(&self) -> MediaEndpoint {
        self.endpoint.clone()
    }
    pub fn status(&self) -> RouteStatus {
        if *self.cancel.borrow() || *self.parent.borrow() || self.parent.has_changed().is_err() {
            return RouteStatus::default();
        }
        self.route.borrow().clone()
    }
    pub fn close(&self) {
        self.cancel.send_replace(true);
    }
}

async fn prepare(
    engine: Arc<NativeCoreInstance>,
    desktop: bool,
    route: watch::Receiver<RouteStatus>,
    lifetime: Lifetime,
) -> Result<(Server, MediaEndpoint)> {
    let listener = Arc::new(listener::LocalSocket(
        UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await?,
    ));
    let local = listener.0.local_addr()?;
    let mut endpoint = endpoint(local, desktop);
    let peer = endpoint
        .remote_address
        .parse::<IpAddr>()
        .map_err(|_| Error::Invalid)?;
    let generator = socket::Generator::new(engine, peer, route, lifetime.clone());
    let server = create_server(listener, &endpoint, generator).await?;
    match tcp::start(local, lifetime).await {
        Ok(address) => endpoint.urls.push(format!("turn:{address}?transport=tcp")),
        Err(error) => {
            if let Err(close_error) = server.close().await {
                eprintln!("native media adapter cleanup failed: {close_error}");
            }
            return Err(error.into());
        }
    }
    Ok((server, endpoint))
}

impl Drop for MediaProxy {
    fn drop(&mut self) {
        self.close();
    }
}

fn endpoint(listener: SocketAddr, desktop: bool) -> MediaEndpoint {
    let mut random = [0u8; 32];
    rand::rng().fill_bytes(&mut random);
    let credential = random.iter().map(|byte| format!("{byte:02x}")).collect();
    let local = if desktop { 1 } else { 2 };
    let remote = if desktop { 2 } else { 1 };
    MediaEndpoint {
        urls: vec![format!("turn:{listener}?transport=udp")],
        username: "desktop-media".into(),
        credential,
        local_address: format!("10.253.0.{local}"),
        remote_address: format!("10.253.0.{remote}"),
    }
}

struct Authentication(Vec<u8>);
impl AuthHandler for Authentication {
    fn auth_handle(
        &self,
        username: &str,
        realm: &str,
        source: SocketAddr,
    ) -> std::result::Result<Vec<u8>, turn::Error> {
        if username != "desktop-media" || realm != REALM || !source.ip().is_loopback() {
            return Err(turn::Error::ErrFakeErr);
        }
        Ok(self.0.clone())
    }
}

async fn create_server(
    listener: Arc<listener::LocalSocket>,
    endpoint: &MediaEndpoint,
    generator: socket::Generator,
) -> Result<Server> {
    Server::new(ServerConfig {
        conn_configs: vec![ConnConfig {
            conn: listener,
            relay_addr_generator: Box::new(generator),
        }],
        realm: REALM.into(),
        auth_handler: Arc::new(Authentication(generate_auth_key(
            &endpoint.username,
            REALM,
            &endpoint.credential,
        ))),
        channel_bind_timeout: Duration::from_secs(0),
        alloc_close_notify: None,
    })
    .await
    .map_err(|_| Error::Unavailable)
}
