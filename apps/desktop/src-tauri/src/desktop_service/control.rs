//! Local owner controls: status, permission changes, and the fixed desktop RPCs. Credentials are never returned.
use super::{
    assets, configuration, control_listener::Listener, installer, supervisor, Result, ServiceError,
};
use crate::remote_desktop::{permissions::Permissions, service_worker::Call};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{os::windows::io::AsRawHandle, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::windows::named_pipe::{ClientOptions, NamedPipeServer},
};

const PIPE: &str = r"\\.\pipe\codex-switch-desktop-control";
const MAX_BYTES: u64 = 1024 * 1024;
#[derive(Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
enum Request {
    Status,
    Permissions { permissions: Permissions },
    Desktop { call: Call },
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub permissions: Permissions,
    pub base_url: String,
    pub name: String,
    // Older services omit this field and receive one compatibility update on the next app start.
    #[serde(default)]
    pub version: Option<String>,
    // The semantic version alone cannot distinguish local rebuilds or missing new components.
    #[serde(default)]
    pub executable_fingerprint: Option<String>,
}
#[derive(Deserialize, Serialize)]
struct Response {
    data: Option<Value>,
    error: Option<String>,
}

fn snapshot(config: configuration::Configuration, fingerprint: String) -> Snapshot {
    Snapshot {
        permissions: config.permissions,
        base_url: config.base_url,
        name: config.name,
        version: Some(config.version),
        executable_fingerprint: Some(fingerprint),
    }
}
pub(super) async fn serve() -> Result<()> {
    let config = configuration::read()?;
    let acl = format!(
        "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;{})",
        config.owner_sid
    );
    serve_pipe(Listener::new(PIPE, &acl)?).await
}

async fn serve_pipe(mut listener: Listener) -> Result<()> {
    loop {
        let mut pipe = listener.accept().await?;
        serve_connection(&mut pipe).await?;
    }
}

async fn serve_connection(pipe: &mut NamedPipeServer) -> Result<()> {
    let mut pipe = BufReader::new(pipe);
    let mut bytes = Vec::new();
    let read = tokio::time::timeout(
        Duration::from_secs(5),
        (&mut pipe)
            .take(MAX_BYTES + 1)
            .read_until(b'\n', &mut bytes),
    )
    .await;
    if !matches!(read, Ok(Ok(_))) || bytes.len() as u64 > MAX_BYTES || bytes.last() != Some(&b'\n')
    {
        return Ok(());
    }
    let result = match serde_json::from_slice::<Request>(&bytes) {
        Ok(request) => handle(request).await,
        Err(_) => Err(ServiceError::Invalid),
    };
    respond(&mut pipe, result).await
}

async fn respond(pipe: &mut BufReader<&mut NamedPipeServer>, result: Result<Value>) -> Result<()> {
    let response = match result {
        Ok(data) => Response {
            data: Some(data),
            error: None,
        },
        Err(error) => Response {
            data: None,
            error: Some(error.to_string()),
        },
    };
    let mut bytes = serde_json::to_vec(&response).map_err(|_| ServiceError::Invalid)?;
    bytes.push(b'\n');
    if !matches!(
        tokio::time::timeout(Duration::from_secs(5), pipe.get_mut().write_all(&bytes)).await,
        Ok(Ok(()))
    ) {
        eprintln!("desktop owner response unavailable");
        return Ok(());
    }
    // Wait for consumption before disconnecting; never block on FlushFileBuffers.
    let mut acknowledgement = [0u8; 1];
    if !matches!(
        tokio::time::timeout(
            Duration::from_secs(3),
            pipe.read_exact(&mut acknowledgement)
        )
        .await,
        Ok(Ok(_))
    ) {
        eprintln!("desktop owner acknowledgement unavailable");
    }
    Ok(())
}
async fn handle(request: Request) -> Result<Value> {
    match request {
        Request::Desktop { call } => supervisor::desktop_call(call).await,
        Request::Status => {
            let status = tauri::async_runtime::spawn_blocking(|| {
                Ok::<_, ServiceError>(snapshot(
                    configuration::read()?,
                    assets::executable_fingerprint()?,
                ))
            })
            .await
            .map_err(|_| ServiceError::Unavailable)??;
            serde_json::to_value(status).map_err(|_| ServiceError::Invalid)
        }
        Request::Permissions { permissions } => {
            let status = tauri::async_runtime::spawn_blocking(move || {
                let fingerprint = assets::executable_fingerprint()?;
                let mut config = configuration::read()?;
                config.permissions = permissions;
                configuration::write(&config)?;
                Ok::<_, ServiceError>(snapshot(config, fingerprint))
            })
            .await
            .map_err(|_| ServiceError::Unavailable)??;
            supervisor::reset_worker().await;
            serde_json::to_value(status).map_err(|_| ServiceError::Invalid)
        }
    }
}

async fn request(request: Request) -> Result<Value> {
    let status = tauri::async_runtime::spawn_blocking(installer::query)
        .await
        .map_err(|_| ServiceError::Unavailable)??
        .ok_or(ServiceError::Unavailable)?;
    let expected = status.process_id.ok_or(ServiceError::Unavailable)?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    let pipe = loop {
        match ClientOptions::new().open(PIPE) {
            Ok(pipe) => break pipe,
            Err(_) if tokio::time::Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(50)).await
            }
            Err(_) => return Err(ServiceError::Unavailable),
        }
    };
    let mut pid = 0;
    // SAFETY: the pipe handle and PID output are live; SCM supplies the trusted expected service process.
    if unsafe {
        windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId(
            pipe.as_raw_handle(),
            &mut pid,
        )
    } == 0
        || pid != expected
    {
        return Err(ServiceError::Denied);
    }
    let mut pipe = BufReader::new(pipe);
    let mut bytes = serde_json::to_vec(&request).map_err(|_| ServiceError::Invalid)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(ServiceError::Invalid);
    }
    bytes.push(b'\n');
    pipe.get_mut()
        .write_all(&bytes)
        .await
        .map_err(|_| ServiceError::Unavailable)?;
    bytes.clear();
    tokio::time::timeout(
        Duration::from_secs(25),
        (&mut pipe)
            .take(MAX_BYTES + 1)
            .read_until(b'\n', &mut bytes),
    )
    .await
    .map_err(|_| ServiceError::Unavailable)?
    .map_err(|_| ServiceError::Unavailable)?;
    if bytes.len() as u64 > MAX_BYTES || bytes.last() != Some(&b'\n') {
        return Err(ServiceError::Invalid);
    }
    let response: Response = serde_json::from_slice(&bytes).map_err(|_| ServiceError::Invalid)?;
    pipe.get_mut()
        .write_all(b"\x01")
        .await
        .map_err(|_| ServiceError::Unavailable)?;
    match response.error {
        Some(error) => Err(ServiceError::Remote(error)),
        None => Ok(response.data.unwrap_or(Value::Null)),
    }
}
pub(crate) async fn read() -> Result<Snapshot> {
    serde_json::from_value(request(Request::Status).await?).map_err(|_| ServiceError::Invalid)
}
pub(crate) async fn update(permissions: Permissions) -> Result<()> {
    request(Request::Permissions { permissions }).await?;
    Ok(())
}
pub(super) async fn desktop(command: &str, args: Value) -> Result<Value> {
    request(Request::Desktop {
        call: Call {
            id: 1,
            command: command.into(),
            args,
        },
    })
    .await
}
pub(crate) async fn running() -> Result<bool> {
    let status = tauri::async_runtime::spawn_blocking(installer::query)
        .await
        .map_err(|_| ServiceError::Unavailable)??;
    Ok(status.is_some_and(|status| {
        status.current_state == windows_service::service::ServiceState::Running
    }))
}

/// A stopped service retains its saved policy. Never acknowledge a change written only to the user copy.
pub(crate) async fn permission_service(updating: bool) -> Result<bool> {
    let status = tauri::async_runtime::spawn_blocking(installer::query)
        .await
        .map_err(|_| ServiceError::Unavailable)??;
    policy_target(status.map(|status| status.current_state), updating)
}

fn policy_target(
    state: Option<windows_service::service::ServiceState>,
    updating: bool,
) -> Result<bool> {
    use windows_service::service::ServiceState;
    match state {
        Some(ServiceState::Running) => Ok(true),
        Some(_) if updating => Err(ServiceError::Remote(
            "请先重新启用或卸载无人值守，再修改权限。".into(),
        )),
        _ => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_service::platform;
    use windows_service::service::ServiceState;
    #[test]
    fn service_outages_cannot_acknowledge_user_only_policy_updates() {
        for state in [
            ServiceState::Stopped,
            ServiceState::StartPending,
            ServiceState::StopPending,
        ] {
            assert!(policy_target(Some(state), true).is_err());
            assert!(!policy_target(Some(state), false).unwrap());
        }
        assert!(!policy_target(None, true).unwrap());
        assert!(policy_target(Some(ServiceState::Running), true).unwrap());
    }

    async fn connect(name: &str) -> tokio::net::windows::named_pipe::NamedPipeClient {
        let until = tokio::time::Instant::now() + Duration::from_secs(2);
        loop {
            match ClientOptions::new().open(name) {
                Ok(client) => return client,
                Err(error)
                    if error.raw_os_error()
                        == Some(windows_sys::Win32::Foundation::ERROR_PIPE_BUSY as i32)
                        && tokio::time::Instant::now() < until =>
                {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                Err(error) => {
                    panic!("Owner control pipe disappeared or became unavailable: {error}")
                }
            }
        }
    }

    fn listener() -> (String, Listener) {
        let name = format!(
            r"\\.\pipe\codex-switch-desktop-control-test-{}",
            uuid::Uuid::new_v4()
        );
        let acl = format!("D:P(A;;GA;;;{})", platform::user_sid().unwrap());
        let pipe = Listener::new(&name, &acl).unwrap();
        (name, pipe)
    }

    #[tokio::test]
    async fn consecutive_requests_keep_listening_while_previous_clients_hold_handles() {
        let (name, pipe) = listener();
        let server = tokio::spawn(serve_pipe(pipe));
        let mut previous_clients = Vec::new();
        for _ in 0..8 {
            let mut client = BufReader::new(connect(&name).await);
            client.get_mut().write_all(b"{}\n").await.unwrap();
            let mut response = String::new();
            tokio::time::timeout(Duration::from_secs(2), client.read_line(&mut response))
                .await
                .unwrap()
                .unwrap();
            assert!(serde_json::from_str::<Response>(&response)
                .unwrap()
                .error
                .is_some());
            client.get_mut().write_all(b"\x01").await.unwrap();
            // Deliberately retain the client handle after acknowledgement to reproduce the VM failure.
            previous_clients.push(client);
        }
        assert!(!server.is_finished());
        server.abort();
        assert!(server.await.unwrap_err().is_cancelled());
    }

    #[tokio::test]
    async fn disconnected_or_incomplete_clients_do_not_stop_owner_controls() {
        let (name, pipe) = listener();
        let server = tokio::spawn(serve_pipe(pipe));
        for _ in 0..3 {
            let mut client = connect(&name).await;
            client.write_all(b"{").await.unwrap();
            drop(client);
        }
        let mut client = BufReader::new(connect(&name).await);
        client.get_mut().write_all(b"{}\n").await.unwrap();
        let mut response = String::new();
        tokio::time::timeout(Duration::from_secs(2), client.read_line(&mut response))
            .await
            .unwrap()
            .unwrap();
        assert!(serde_json::from_str::<Response>(&response)
            .unwrap()
            .error
            .is_some());
        assert!(!server.is_finished());
        server.abort();
        assert!(server.await.unwrap_err().is_cancelled());
    }
}
