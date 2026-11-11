use super::{
    super::{ComputerError, Result},
    native,
};
use serde::{de::DeserializeOwned, Serialize};
use std::{ffi::c_void, mem::size_of, os::windows::io::AsRawHandle, ptr, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::windows::named_pipe::{ClientOptions, NamedPipeClient, NamedPipeServer, ServerOptions},
};
use windows_sys::Win32::{Foundation::LocalFree, Security::*, System::Pipes::*};

pub(super) const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_HANDSHAKE_BYTES: u64 = 4096;

pub(super) fn name(id: uuid::Uuid) -> String {
    format!(r"\\.\pipe\remoteai-cua-{id}")
}

pub(super) fn server(id: uuid::Uuid, first: bool) -> Result<NamedPipeServer> {
    let sddl = native::wide(&native::user_acl()?);
    let mut descriptor = ptr::null_mut();
    if unsafe {
        Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            ptr::null_mut(),
        )
    } == 0
    {
        return Err(ComputerError::Administrator);
    }
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor,
        bInheritHandle: 0,
    };
    // Reject network clients and reserve the name before asking for consent.
    let result = unsafe {
        ServerOptions::new()
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .create_with_security_attributes_raw(
                name(id),
                &attributes as *const SECURITY_ATTRIBUTES as *mut c_void,
            )
    };
    unsafe {
        LocalFree(descriptor);
    }
    result.map_err(|_| ComputerError::Administrator)
}

pub(super) async fn connect(id: uuid::Uuid, expected: u32) -> Result<NamedPipeClient> {
    let deadline = tokio::time::Instant::now() + CONNECT_TIMEOUT;
    loop {
        match ClientOptions::new().open(name(id)) {
            Ok(pipe) => {
                let mut pid = 0;
                if unsafe { GetNamedPipeServerProcessId(pipe.as_raw_handle(), &mut pid) } == 0
                    || pid != expected
                {
                    return Err(ComputerError::Administrator);
                }
                native::Process::open(pid)?.trusted()?;
                return Ok(pipe);
            }
            Err(_) if tokio::time::Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(_) => return Err(ComputerError::Administrator),
        }
    }
}

pub(super) fn client(pipe: &NamedPipeServer) -> Result<u32> {
    let mut pid = 0;
    if unsafe { GetNamedPipeClientProcessId(pipe.as_raw_handle(), &mut pid) } == 0 {
        return Err(ComputerError::Administrator);
    }
    native::Process::open(pid)?.trusted()?;
    Ok(pid)
}

pub(super) async fn read<T: DeserializeOwned, R: tokio::io::AsyncRead + Unpin>(
    input: R,
) -> Result<T> {
    let mut bytes = Vec::new();
    let mut reader = BufReader::new(input.take(MAX_HANDSHAKE_BYTES + 1));
    tokio::time::timeout(CONNECT_TIMEOUT, reader.read_until(b'\n', &mut bytes))
        .await
        .map_err(|_| ComputerError::Administrator)?
        .map_err(|_| ComputerError::Administrator)?;
    if bytes.len() as u64 > MAX_HANDSHAKE_BYTES || bytes.last() != Some(&b'\n') {
        return Err(ComputerError::Administrator);
    }
    serde_json::from_slice(&bytes).map_err(|_| ComputerError::Administrator)
}

pub(super) async fn write<T: Serialize, W: tokio::io::AsyncWrite + Unpin>(
    mut output: W,
    value: &T,
) -> Result<()> {
    let mut bytes = serde_json::to_vec(value).map_err(|_| ComputerError::Administrator)?;
    bytes.push(b'\n');
    output
        .write_all(&bytes)
        .await
        .map_err(|_| ComputerError::Administrator)
}
