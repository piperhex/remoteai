use std::{
    collections::HashMap,
    fs, io,
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use uuid::Uuid;

use super::sessions::{self, HostRequest, SessionRequest};
use super::{config, protocol::*, transport, BrowserError, Result};

// Retained MCP leases must leave room for tool calls and discovery probes.
const MAX_CONNECTIONS: usize = 64;
pub(super) const REQUEST_TIMEOUT: Duration = Duration::from_secs(130);
const STATUS_TIMEOUT: Duration = Duration::from_secs(1);
const REVOCATION_INTERVAL: Duration = Duration::from_millis(250);
type Pending = HashMap<String, mpsc::Sender<BrowserReply>>;

#[cfg(test)]
#[path = "native_tests.rs"]
mod tests;

struct Host {
    root: PathBuf,
    writer: Mutex<io::Stdout>,
    pending: Mutex<Pending>,
    alive: AtomicBool,
    connections: AtomicUsize,
    sessions: Mutex<HashMap<(String, String), usize>>,
}

pub(super) fn run(root: PathBuf) -> Result<()> {
    fs::create_dir_all(root.join("endpoints")).map_err(|_| BrowserError::Storage)?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| BrowserError::Transport)?;
    let port = listener
        .local_addr()
        .map_err(|_| BrowserError::Transport)?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|_| BrowserError::Transport)?;
    let host = Arc::new(Host {
        root,
        writer: Mutex::new(io::stdout()),
        pending: Mutex::new(HashMap::new()),
        alive: AtomicBool::new(true),
        connections: AtomicUsize::new(0),
        sessions: Mutex::new(HashMap::new()),
    });
    let id = Uuid::new_v4().to_string();
    let endpoint_path = host.root.join("endpoints").join(format!("{id}.json"));
    let server = host.clone();
    thread::spawn(move || serve(server, listener));
    let result = receive(
        &host,
        &Endpoint {
            id,
            port,
            name: "Chrome".into(),
        },
    );
    host.alive.store(false, Ordering::Release);
    if let Ok(mut pending) = host.pending.lock() {
        pending.clear();
    }
    if endpoint_path.exists() {
        fs::remove_file(endpoint_path).map_err(|_| BrowserError::Storage)?;
    }
    result
}

fn receive(host: &Host, endpoint: &Endpoint) -> Result<()> {
    let mut input = io::stdin().lock();
    while let Some(message) = transport::read_frame(&mut input, transport::MAX_RESPONSE_BYTES)? {
        match message {
            ExtensionMessage::Ready { name } => publish(host, endpoint, name)?,
            ExtensionMessage::Reply { id, reply } => {
                let sender = host
                    .pending
                    .lock()
                    .map_err(|_| BrowserError::Transport)?
                    .remove(&id);
                if let Some(sender) = sender {
                    // A disconnected MCP caller can abandon a response while Chrome is still finishing it.
                    if sender.send(reply).is_err() {
                        continue;
                    }
                }
            }
        }
    }
    Ok(())
}

fn publish(host: &Host, endpoint: &Endpoint, name: String) -> Result<()> {
    if name.len() > 100 || name.chars().any(char::is_control) {
        return Err(BrowserError::InvalidRequest);
    }
    let endpoint = Endpoint {
        name,
        ..endpoint.clone()
    };
    let path = host
        .root
        .join("endpoints")
        .join(format!("{}.json", endpoint.id));
    crate::storage::write_json_atomic(
        &path,
        &serde_json::to_value(endpoint).map_err(|_| BrowserError::Storage)?,
    )
    .map_err(|_| BrowserError::Storage)
}

fn serve(host: Arc<Host>, listener: TcpListener) {
    while host.alive.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((stream, _)) => {
                if host.connections.load(Ordering::Acquire) >= MAX_CONNECTIONS {
                    continue;
                }
                host.connections.fetch_add(1, Ordering::AcqRel);
                let host = host.clone();
                thread::spawn(move || {
                    if let Err(error) = handle(&host, stream) {
                        eprintln!("{error}");
                    }
                    host.connections.fetch_sub(1, Ordering::AcqRel);
                });
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(50))
            }
            Err(_) => break,
        }
    }
}

fn handle(host: &Host, mut stream: TcpStream) -> Result<()> {
    configure_stream(&stream)?;
    let request: HostRequest = transport::read_frame(&mut stream, transport::MAX_REQUEST_BYTES)?
        .ok_or(BrowserError::InvalidRequest)?;
    let request = match request {
        HostRequest::Session(request) => return session(host, &mut stream, request),
        HostRequest::Call(request) => request,
    };
    let result = forward(host, request).unwrap_or_else(BrowserReply::error);
    transport::write_frame(&mut stream, &result, transport::MAX_RESPONSE_BYTES)
}

fn configure_stream(stream: &TcpStream) -> Result<()> {
    // Windows accepts inherit the listener's nonblocking mode. Frame reads and
    // session leases need blocking I/O so their timeouts actually wait.
    stream
        .set_nonblocking(false)
        .map_err(|_| BrowserError::Transport)?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| BrowserError::Transport)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| BrowserError::Transport)
}

fn session(host: &Host, stream: &mut TcpStream, request: SessionRequest) -> Result<()> {
    let SessionRequest::Session {
        client_id,
        session_id,
        token,
    } = &request;
    config::authorize(&host.root, client_id, token)?;
    Uuid::parse_str(session_id).map_err(|_| BrowserError::InvalidRequest)?;
    let key = (client_id.clone(), session_id.clone());
    {
        let mut sessions = host.sessions.lock().map_err(|_| BrowserError::Transport)?;
        *sessions.entry(key.clone()).or_default() += 1;
    }
    let reply = BrowserReply {
        result: Some(serde_json::json!({})),
        error: None,
    };
    let result = transport::write_frame(stream, &reply, transport::MAX_RESPONSE_BYTES)
        .and_then(|()| sessions::wait(stream, &host.root, &request, &host.alive));
    // Serialize the last-session notification with new registrations, before acknowledging a new lease.
    let mut sessions = host.sessions.lock().map_err(|_| BrowserError::Transport)?;
    if let Some(count) = sessions.get_mut(&key) {
        *count -= 1;
        if *count == 0 {
            sessions.remove(&key);
            let message = serde_json::json!({"type":"client-disconnected",
                "clientId":client_id,"sessionId":session_id});
            let mut writer = host.writer.lock().map_err(|_| BrowserError::Transport)?;
            transport::write_frame(&mut *writer, &message, transport::MAX_REQUEST_BYTES)?;
        }
    }
    result
}

fn forward(host: &Host, request: BridgeRequest) -> Result<BrowserReply> {
    config::authorize(&host.root, &request.client_id, &request.token)?;
    request.request.validate()?;
    let id = Uuid::new_v4().to_string();
    let (sender, receiver) = mpsc::channel();
    host.pending
        .lock()
        .map_err(|_| BrowserError::Transport)?
        .insert(id.clone(), sender);
    let outgoing = ExtensionRequest {
        id: id.clone(),
        client_id: request.client_id.clone(),
        session_id: request.session_id.clone(),
        request: request.request.clone(),
    };
    let sent = send_request(host, &request, &outgoing);
    let result = sent.and_then(|()| await_reply(host, &request, receiver));
    host.pending
        .lock()
        .map_err(|_| BrowserError::Transport)?
        .remove(&id);
    if result.is_err() {
        let cancellation = serde_json::json!({"type":"cancel", "id":id});
        // Best effort: a closed Chrome pipe has no remaining request to cancel.
        if let Ok(mut writer) = host.writer.lock() {
            if let Err(error) =
                transport::write_frame(&mut *writer, &cancellation, transport::MAX_REQUEST_BYTES)
            {
                eprintln!("{error}");
            }
        }
    }
    result
}

fn send_request(host: &Host, request: &BridgeRequest, outgoing: &ExtensionRequest) -> Result<()> {
    // A departing session cannot notify Chrome and then have a previously queued request reattach it.
    let sessions = host.sessions.lock().map_err(|_| BrowserError::Transport)?;
    if let Some(session_id) = &request.session_id {
        if !sessions.contains_key(&(request.client_id.clone(), session_id.clone())) {
            return Err(BrowserError::Disconnected);
        }
    }
    let mut writer = host.writer.lock().map_err(|_| BrowserError::Transport)?;
    transport::write_frame(&mut *writer, outgoing, transport::MAX_REQUEST_BYTES)
}

fn await_reply(
    host: &Host,
    request: &BridgeRequest,
    receiver: mpsc::Receiver<BrowserReply>,
) -> Result<BrowserReply> {
    let timeout = if matches!(request.request.operation, Operation::Status) {
        STATUS_TIMEOUT
    } else {
        REQUEST_TIMEOUT
    };
    let deadline = Instant::now() + timeout;
    loop {
        config::authorize(&host.root, &request.client_id, &request.token)?;
        if !host.alive.load(Ordering::Acquire) {
            return Err(BrowserError::Disconnected);
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(BrowserError::Timeout);
        }
        match receiver.recv_timeout(remaining.min(REVOCATION_INTERVAL)) {
            Ok(reply) => {
                config::authorize(&host.root, &request.client_id, &request.token)?;
                return Ok(reply);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err(BrowserError::Disconnected),
        }
    }
}

pub(super) fn connect(endpoint: &Endpoint) -> io::Result<TcpStream> {
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], endpoint.port));
    TcpStream::connect_timeout(&address, Duration::from_millis(400))
}

pub(super) fn call(endpoint: &Endpoint, request: &BridgeRequest) -> Result<BrowserReply> {
    let stream = connect(endpoint).map_err(|_| BrowserError::Disconnected)?;
    exchange(stream, request)
}

pub(super) fn exchange(mut stream: TcpStream, request: &BridgeRequest) -> Result<BrowserReply> {
    let timeout = if matches!(request.request.operation, Operation::Status) {
        Duration::from_secs(2)
    } else {
        REQUEST_TIMEOUT + Duration::from_secs(5)
    };
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|_| BrowserError::Transport)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| BrowserError::Transport)?;
    transport::write_frame(&mut stream, request, transport::MAX_REQUEST_BYTES)?;
    transport::read_frame(&mut stream, transport::MAX_RESPONSE_BYTES)?
        .ok_or(BrowserError::Disconnected)
}
