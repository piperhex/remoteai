//! Chromium can bind UDP to a physical adapter that cannot reach loopback on Windows.
//! TCP lets the OS select loopback; framing terminates here and media still uses native datagrams.
use super::Lifetime;
use std::{io, net::SocketAddr, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::Semaphore,
    task::JoinSet,
};

const MAX_CONNECTIONS: usize = 32;
const MAX_FRAME: usize = 65_556;
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

pub(super) async fn start(
    destination: SocketAddr,
    mut lifetime: Lifetime,
) -> io::Result<SocketAddr> {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
    let address = listener.local_addr()?;
    tokio::spawn(async move {
        let permits = Arc::new(Semaphore::new(MAX_CONNECTIONS));
        let mut clients = JoinSet::new();
        loop {
            if lifetime.closed() {
                break;
            }
            tokio::select! {
                _ = lifetime.finished() => break,
                Some(_) = clients.join_next(), if !clients.is_empty() => {},
                accepted = listener.accept() => {
                    let Ok((stream, source)) = accepted else { break };
                    let Ok(permit) = permits.clone().try_acquire_owned() else { continue };
                    if !source.ip().is_loopback() { continue; }
                    clients.spawn(async move {
                        let _permit = permit;
                        // EOF, idle expiry and malformed packets close only this local client.
                        if let Err(error) = forward(stream, destination).await {
                            if !matches!(error.kind(), io::ErrorKind::UnexpectedEof
                                | io::ErrorKind::ConnectionReset | io::ErrorKind::TimedOut) {
                                eprintln!("native media local TCP stopped: {}", error.kind());
                            }
                        }
                    });
                }
            }
        }
        // Dropping the set aborts every client on view close or grant revocation.
    });
    Ok(address)
}

async fn forward(stream: TcpStream, destination: SocketAddr) -> io::Result<()> {
    stream.set_nodelay(true)?;
    let socket = UdpSocket::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
    socket.connect(destination).await?;
    let (mut reader, mut writer) = stream.into_split();
    // Keep partial TCP reads alive while UDP responses arrive.
    tokio::try_join!(upload(&socket, &mut reader), download(&socket, &mut writer))?;
    Ok(())
}

async fn upload<R: AsyncRead + Unpin>(socket: &UdpSocket, reader: &mut R) -> io::Result<()> {
    loop {
        let frame = tokio::time::timeout(IDLE_TIMEOUT, read_frame(reader)).await??;
        socket.send(&frame).await?;
    }
}

async fn download<W: AsyncWrite + Unpin>(socket: &UdpSocket, writer: &mut W) -> io::Result<()> {
    let mut buffer = vec![0; MAX_FRAME];
    loop {
        let length = tokio::time::timeout(IDLE_TIMEOUT, socket.recv(&mut buffer)).await??;
        tokio::time::timeout(IDLE_TIMEOUT, write_frame(writer, &buffer[..length])).await??;
    }
}

async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> io::Result<Vec<u8>> {
    let mut header = [0; 4];
    reader.read_exact(&mut header).await?;
    let (size, padded) = frame_size(&header)?;
    let mut frame = vec![0; padded];
    frame[..4].copy_from_slice(&header);
    reader.read_exact(&mut frame[4..]).await?;
    frame.truncate(size);
    Ok(frame)
}

async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, frame: &[u8]) -> io::Result<()> {
    let (size, padded) = frame_size(frame)?;
    if frame.len() < size || frame.len() > padded {
        return Err(io::ErrorKind::InvalidData.into());
    }
    writer.write_all(&frame[..size]).await?;
    writer.write_all(&[0; 3][..padded - size]).await
}

fn frame_size(header: &[u8]) -> io::Result<(usize, usize)> {
    if header.len() < 4 || header[0] & 0x80 != 0 {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let channel = header[0] & 0xc0 == 0x40;
    let size =
        usize::from(u16::from_be_bytes([header[2], header[3]])) + if channel { 4 } else { 20 };
    if size > MAX_FRAME || (!channel && size % 4 != 0) {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok((size, if channel { (size + 3) & !3 } else { size }))
}

#[cfg(test)]
#[path = "tcp_tests.rs"]
mod tests;
