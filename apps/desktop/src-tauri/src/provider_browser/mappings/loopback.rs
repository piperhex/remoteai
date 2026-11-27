//! Chromium bypasses PAC for localhost names. Give those exact browser origins revocable loopback destinations.
use std::net::{Ipv4Addr, SocketAddr};
use tokio::{
    net::{TcpListener, TcpStream},
    task::{JoinHandle, JoinSet},
};

pub(super) struct Alias {
    pub port: u16,
    worker: JoinHandle<()>,
}

impl Alias {
    pub fn bind(target: SocketAddr) -> std::io::Result<Self> {
        let socket = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        socket.set_nonblocking(true)?;
        let listener = TcpListener::from_std(socket)?;
        let port = listener.local_addr()?.port();
        let worker = tokio::spawn(async move {
            let mut streams = JoinSet::new();
            loop {
                tokio::select! {
                    _ = streams.join_next(), if !streams.is_empty() => {}
                    incoming = listener.accept() => {
                        let Ok((mut browser, _)) = incoming else { break };
                        if streams.len() >= 64 { continue; }
                        streams.spawn(async move {
                            let mut service = TcpStream::connect(target).await?;
                            tokio::io::copy_bidirectional(&mut browser, &mut service).await
                        });
                    }
                }
            }
        });
        Ok(Self { port, worker })
    }
}

impl Drop for Alias {
    fn drop(&mut self) {
        self.worker.abort();
    }
}
