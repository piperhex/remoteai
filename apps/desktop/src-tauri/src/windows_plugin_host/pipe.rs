use super::{native, Endpoint, Error, Result};
use serde::{de::DeserializeOwned, Serialize};
use std::{os::windows::io::AsRawHandle, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::windows::named_pipe::{ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions},
};
use windows_sys::Win32::System::Pipes::{GetNamedPipeClientProcessId, GetNamedPipeServerProcessId};

const TIMEOUT: Duration = Duration::from_secs(5);
const MAX_BYTES: u64 = 1024;

fn name(channel: uuid::Uuid) -> String {
    format!(r"\\.\pipe\remoteai-plugins-{channel}")
}

pub(super) fn server(channel: uuid::Uuid, first: bool) -> Result<NamedPipeServer> {
    ServerOptions::new()
        .first_pipe_instance(first)
        .reject_remote_clients(true)
        .create(name(channel))
        .map_err(|_| Error::Unavailable)
}

pub(super) async fn connect(endpoint: &Endpoint) -> Result<NamedPipeClient> {
    let deadline = tokio::time::Instant::now() + TIMEOUT;
    loop {
        match ClientOptions::new().open(name(endpoint.channel)) {
            Ok(pipe) => {
                let mut pid = 0;
                // SAFETY: the pipe owns a live handle and pid is writable for the call.
                if unsafe { GetNamedPipeServerProcessId(pipe.as_raw_handle(), &mut pid) } == 0
                    || pid != endpoint.owner
                {
                    return Err(Error::Unavailable);
                }
                native::Peer::open(pid)?;
                return Ok(pipe);
            }
            Err(_) if tokio::time::Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(25)).await
            }
            Err(_) => return Err(Error::Unavailable),
        }
    }
}

pub(super) fn client(pipe: &NamedPipeServer) -> Result<native::Peer> {
    let mut pid = 0;
    // SAFETY: the connected pipe owns a live handle and pid is writable for the call.
    if unsafe { GetNamedPipeClientProcessId(pipe.as_raw_handle(), &mut pid) } == 0 {
        return Err(Error::Unavailable);
    }
    native::Peer::open(pid)
}

pub(super) async fn read<T: DeserializeOwned>(
    input: &mut (impl tokio::io::AsyncRead + Unpin),
) -> Result<T> {
    let mut bytes = Vec::new();
    let mut reader = BufReader::new(input.take(MAX_BYTES + 1));
    tokio::time::timeout(TIMEOUT, reader.read_until(b'\n', &mut bytes))
        .await
        .map_err(|_| Error::Unavailable)?
        .map_err(|_| Error::Unavailable)?;
    if bytes.len() as u64 > MAX_BYTES || bytes.last() != Some(&b'\n') {
        return Err(Error::Unavailable);
    }
    serde_json::from_slice(&bytes).map_err(|_| Error::Unavailable)
}

pub(super) async fn write(
    output: &mut (impl tokio::io::AsyncWrite + Unpin),
    value: &impl Serialize,
) -> Result<()> {
    let mut bytes = serde_json::to_vec(value).map_err(|_| Error::Unavailable)?;
    bytes.push(b'\n');
    tokio::time::timeout(TIMEOUT, output.write_all(&bytes))
        .await
        .map_err(|_| Error::Unavailable)?
        .map_err(|_| Error::Unavailable)
}
