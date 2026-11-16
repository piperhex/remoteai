//! webrtc-rs 0.17 gathers TURN over UDP only. Adapt TCP/TLS framing on private loopback sockets.
//! Authentication and allocation stay in its TURN client; TLS always validates the remote certificate.
use super::model::{Error, Result};
use std::{io, net::SocketAddr, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{TcpStream, UdpSocket},
    task::JoinHandle,
};
use tokio_rustls::{rustls, TlsConnector};
use webrtc::ice::url::{ProtoType, SchemeType, Url};
use webrtc::ice_transport::ice_server::RTCIceServer;

const MAX_FRAME: usize = 65_556;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

pub(crate) struct Transports(Vec<JoinHandle<()>>);

impl Transports {
    pub fn close(&self) {
        for task in &self.0 {
            task.abort();
        }
    }
}

impl Drop for Transports {
    fn drop(&mut self) {
        self.close();
    }
}

pub(crate) async fn prepare(servers: &mut [RTCIceServer]) -> Result<Transports> {
    let mut transports = Transports(Vec::new());
    for server in servers {
        for address in &mut server.urls {
            let url = Url::parse_url(address).map_err(|_| Error::Invalid)?;
            if !matches!(url.scheme, SchemeType::Turn | SchemeType::Turns)
                || url.proto != ProtoType::Tcp
            {
                continue;
            }
            let socket = UdpSocket::bind("127.0.0.1:0")
                .await
                .map_err(|_| Error::Transport)?;
            let local = socket.local_addr().map_err(|_| Error::Transport)?;
            *address = format!("turn:{local}?transport=udp");
            transports.0.push(tokio::spawn(async move {
                if let Err(error) = bridge(socket, url).await {
                    // Addresses and credentials are intentionally omitted from logs.
                    eprintln!("desktop TURN transport stopped: {}", error.kind());
                }
            }));
        }
    }
    Ok(transports)
}

async fn bridge(socket: UdpSocket, url: Url) -> io::Result<()> {
    let mut first = vec![0; MAX_FRAME];
    let (length, source) =
        tokio::time::timeout(IDLE_TIMEOUT, socket.recv_from(&mut first)).await??;
    first.truncate(length);
    let stream = tokio::time::timeout(
        CONNECT_TIMEOUT,
        TcpStream::connect((url.host.as_str(), url.port)),
    )
    .await??;
    stream.set_nodelay(true)?;
    if url.scheme != SchemeType::Turns {
        return forward(socket, stream, source, first).await;
    }
    let roots = certificate_roots();
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let name = rustls::pki_types::ServerName::try_from(url.host)
        .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    let connector = TlsConnector::from(Arc::new(config));
    let stream = tokio::time::timeout(CONNECT_TIMEOUT, connector.connect(name, stream)).await??;
    forward(socket, stream, source, first).await
}

fn certificate_roots() -> rustls::RootCertStore {
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    #[cfg(test)]
    let roots = {
        use base64::Engine;
        let mut roots = roots;
        if let Ok(value) = std::env::var("CSW_NATIVE_TEST_CA_BASE64") {
            let der = base64::engine::general_purpose::STANDARD
                .decode(value)
                .expect("test TLS certificate");
            roots.add(der.into()).expect("test TLS root");
        }
        roots
    };
    roots
}

async fn forward<S>(
    socket: UdpSocket,
    stream: S,
    source: SocketAddr,
    first: Vec<u8>,
) -> io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (mut reader, mut writer) = tokio::io::split(stream);
    // Separate loops keep read_exact cancellation-safe when a datagram arrives mid-TCP-frame.
    tokio::try_join!(
        upload(&socket, &mut writer, source, first),
        download(&socket, &mut reader, source),
    )
    .map(|_| ())
}

async fn upload<W: AsyncWrite + Unpin>(
    socket: &UdpSocket,
    writer: &mut W,
    source: SocketAddr,
    first: Vec<u8>,
) -> io::Result<()> {
    write_frame(writer, first).await?;
    let mut buffer = vec![0; MAX_FRAME];
    loop {
        let (length, from) =
            tokio::time::timeout(IDLE_TIMEOUT, socket.recv_from(&mut buffer)).await??;
        if from == source {
            write_frame(writer, buffer[..length].to_vec()).await?;
        }
    }
}

async fn download<R: AsyncRead + Unpin>(
    socket: &UdpSocket,
    reader: &mut R,
    source: SocketAddr,
) -> io::Result<()> {
    loop {
        let frame = tokio::time::timeout(IDLE_TIMEOUT, read_frame(reader)).await??;
        socket.send_to(&frame, source).await?;
    }
}

async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, mut frame: Vec<u8>) -> io::Result<()> {
    let (size, channel) = frame_size(&frame)?;
    if frame.len() < size || frame.len() > (size + 3) & !3 {
        return Err(io::ErrorKind::InvalidData.into());
    }
    if channel {
        frame.resize((size + 3) & !3, 0);
    }
    tokio::time::timeout(CONNECT_TIMEOUT, writer.write_all(&frame)).await?
}

async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> io::Result<Vec<u8>> {
    let mut header = [0; 4];
    reader.read_exact(&mut header).await?;
    let (size, channel) = frame_size(&header)?;
    let padded = if channel { (size + 3) & !3 } else { size };
    let mut frame = vec![0; padded];
    frame[..4].copy_from_slice(&header);
    reader.read_exact(&mut frame[4..]).await?;
    frame.truncate(size);
    Ok(frame)
}

fn frame_size(header: &[u8]) -> io::Result<(usize, bool)> {
    if header.len() < 4 || header[0] & 0x80 != 0 {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let channel = header[0] & 0xc0 == 0x40;
    let size =
        usize::from(u16::from_be_bytes([header[2], header[3]])) + if channel { 4 } else { 20 };
    if size > MAX_FRAME {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok((size, channel))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn preserves_boundaries_across_fragmented_tcp_and_channel_padding() {
        let (mut tx, mut rx) = tokio::io::duplex(8);
        let channel = vec![0x40, 1, 0, 3, 9, 8, 7];
        let mut stun = vec![0; 20];
        stun[1] = 1;
        let sending = tokio::spawn(async move {
            write_frame(&mut tx, channel).await.unwrap();
            write_frame(&mut tx, stun).await.unwrap();
        });
        assert_eq!(read_frame(&mut rx).await.unwrap(), [0x40, 1, 0, 3, 9, 8, 7]);
        assert_eq!(read_frame(&mut rx).await.unwrap().len(), 20);
        sending.await.unwrap();
    }
}
