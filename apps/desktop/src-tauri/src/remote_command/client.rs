use super::{protocol::ToolRequest, RemoteError, Result};
use serde_json::{json, Value};
use std::{
    io::ErrorKind,
    net::TcpStream,
    time::{Duration, Instant},
};
use tungstenite::{stream::MaybeTlsStream, Message, WebSocket};

const CONNECTION_TIMEOUT: Duration = Duration::from_secs(10);
const RESULT_TIMEOUT: Duration = Duration::from_secs(75);

pub(super) fn call<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    request: ToolRequest,
    allowed: impl Fn() -> bool,
) -> Result<Value> {
    if let ToolRequest::Execute { request } = &request {
        request.validate()?;
    }
    let config = crate::cloud::remote_control_config(app)
        .map_err(|_| RemoteError::Authentication)?
        .ok_or(RemoteError::Authentication)?;
    if let ToolRequest::Execute { request } = &request {
        if request.device_id == config.device_id {
            return Err(RemoteError::InvalidRequest);
        }
    }
    let (mut socket, _) = crate::remote_websocket::connect_remote_websocket(&config.websocket_url)
        .map_err(|_| RemoteError::Connection)?;
    set_timeout(&mut socket)?;
    send(
        &mut socket,
        json!({"type":"subscribe-devices", "accessToken":config.access_token}),
    )?;
    let result = receive(&mut socket, &config.device_id, request, || {
        allowed()
            && crate::cloud::remote_control_config(app).is_ok_and(|current| {
                current.is_some_and(|current| current.access_token == config.access_token)
            })
    });
    // Closing the requester socket cancels any pending execution at the coordinator.
    if let Err(error) = socket.close(None) {
        eprintln!("remote command connection closed: {error}");
    }
    result
}

fn receive(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    current_device: &str,
    request: ToolRequest,
    allowed: impl Fn() -> bool,
) -> Result<Value> {
    let id = uuid::Uuid::new_v4().to_string();
    let mut deadline = Instant::now() + CONNECTION_TIMEOUT;
    let mut sent = false;
    let mut checked = Instant::now() - Duration::from_secs(2);
    loop {
        if checked.elapsed() >= Duration::from_secs(1) {
            if !allowed() {
                return Err(RemoteError::Cancelled);
            }
            checked = Instant::now();
        }
        if Instant::now() >= deadline {
            return Err(RemoteError::Timeout);
        }
        let Some(message) = read(socket)? else {
            continue;
        };
        if message["type"] == "devices-snapshot" && !sent {
            let devices = computers(&message, current_device);
            if let Some(result) = prepare(socket, &request, devices, &id)? {
                return Ok(result);
            }
            sent = true;
            deadline = Instant::now() + RESULT_TIMEOUT;
        }
        if sent && message["type"] == "remote-command-result" && message["requestId"] == id {
            let error = match message["errorCode"].as_str() {
                Some("client.remoteCommand.busy") => Value::String(super::messages::busy().into()),
                _ => message["error"].clone(),
            };
            return Ok(json!({"deviceId":match &request {
                ToolRequest::Execute { request } => &request.device_id, _ => current_device,
            }, "data":message["data"], "error":error}));
        }
    }
}

fn prepare(
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    request: &ToolRequest,
    devices: Vec<Value>,
    id: &str,
) -> Result<Option<Value>> {
    let ToolRequest::Execute { request } = request else {
        return Ok(Some(json!({"computers":devices})));
    };
    let target = devices
        .iter()
        .find(|device| device["deviceId"] == request.device_id)
        .ok_or(RemoteError::Denied)?;
    if target["online"] != true {
        return Err(RemoteError::Connection);
    }
    if target["available"] != true {
        return Err(RemoteError::Denied);
    }
    send(
        socket,
        json!({"type":"remote-command", "requestId":id,
        "deviceId":request.device_id, "request":request.command}),
    )?;
    Ok(None)
}

fn computers(message: &Value, current: &str) -> Vec<Value> {
    message["devices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|device| device["deviceId"].as_str().is_some_and(|id| id != current))
        .map(|device| {
            json!({"deviceId":device["deviceId"], "name":device["name"],
            "platform":device["platform"], "online":device["online"],
            "available":device["online"] == true && device["capabilities"].as_array()
                .is_some_and(|items| items.iter().any(|item| item == "remote-command"))})
        })
        .collect()
}

fn read(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>) -> Result<Option<Value>> {
    match socket.read() {
        Ok(Message::Text(text)) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|_| RemoteError::Connection),
        Ok(Message::Ping(payload)) => {
            socket
                .send(Message::Pong(payload))
                .map_err(|_| RemoteError::Connection)?;
            Ok(None)
        }
        Ok(Message::Close(_)) => Err(RemoteError::Connection),
        Err(tungstenite::Error::Io(error))
            if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
        {
            Ok(None)
        }
        Err(_) => Err(RemoteError::Connection),
        _ => Ok(None),
    }
}

fn send(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>, value: Value) -> Result<()> {
    socket
        .send(Message::Text(value.to_string().into()))
        .map_err(|_| RemoteError::Connection)
}

fn set_timeout(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>) -> Result<()> {
    let stream = match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream,
        MaybeTlsStream::Rustls(stream) => &mut stream.sock,
        _ => return Err(RemoteError::Connection),
    };
    stream
        .set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|_| RemoteError::Connection)?;
    stream
        .set_write_timeout(Some(CONNECTION_TIMEOUT))
        .map_err(|_| RemoteError::Connection)
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
