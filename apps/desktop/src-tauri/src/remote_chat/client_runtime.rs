use std::{
    io::ErrorKind,
    net::TcpStream,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use tauri::ipc::Channel;
use tokio::sync::{mpsc, watch};
use tungstenite::{stream::MaybeTlsStream, Error as SocketError, Message, WebSocket};

use super::{
    bridge::{Batch, Bridge},
    client::{ClientCommand, OpenRequest},
    client_bulk::ClientBulk,
    config::Config,
    protocol::{ChatError, Envelope, Event, Outgoing, FRAME_LIMIT},
};

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;
pub(super) struct Lifecycle {
    pub configs: watch::Receiver<Option<Config>>,
    pub cancelled: Arc<AtomicBool>,
    pub tcp_authority: Arc<super::tcp::Authority>,
    pub bulk_events: Option<Channel<tauri::ipc::Response>>,
}
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const PING_INTERVAL: Duration = Duration::from_secs(20);
const RECEIVE_TIMEOUT: Duration = Duration::from_secs(60);
const COMMANDS_PER_TICK: usize = 64;

pub(super) fn run(
    request: OpenRequest,
    events: Channel<Batch>,
    commands: mpsc::Receiver<ClientCommand>,
    life: Lifecycle,
) {
    let code = connect(&request, events.clone(), commands, life).unwrap_or(1006);
    // A final close bypasses a pending batch so a stopped renderer cannot retain the socket.
    if events
        .send(Batch {
            sequence: 0,
            events: vec![Envelope {
                generation: 0,
                event: Event::Closed { code },
            }],
        })
        .is_err()
    {
        // The owning WebView has already gone away; no receiver remains to notify.
    }
}

fn connect(
    request: &OpenRequest,
    events: Channel<Batch>,
    commands: mpsc::Receiver<ClientCommand>,
    life: Lifecycle,
) -> Result<u16, ChatError> {
    let config = life.configs.borrow().clone().ok_or(ChatError::Transport)?;
    if !request.matches(&config) {
        return Ok(4001);
    }
    let mut socket = dial(&config.websocket_url)?;
    if life.cancelled.load(Ordering::Acquire) {
        return Ok(1000);
    }
    if !life
        .configs
        .borrow()
        .as_ref()
        .is_some_and(|current| config.same_owner(current))
    {
        return Ok(4001);
    }
    socket
        .send(Message::Text(
            authentication_message(request, &config, life.bulk_events.is_some())
                .to_string()
                .into(),
        ))
        .map_err(|_| ChatError::Transport)?;
    let bridge = Bridge::new(
        request.client_id.clone(),
        Box::new(move |batch| events.send(batch).is_ok()),
    );
    let now = Instant::now();
    ClientRuntime {
        auth_renewal: super::auth_renewal::AuthRenewal::default(),
        socket,
        tcp: super::tcp::ClientSession::new(life.tcp_authority.clone(), request.client_id.clone()),
        binary_relay: false,
        bulk: ClientBulk::new(life.bulk_events.clone()),
        bridge,
        received: now,
        pinged: now,
        session_id: request
            .resume
            .as_ref()
            .map(|resume| resume.session_id.clone()),
    }
    .poll(commands, life, config)
}

fn authentication_message(request: &OpenRequest, config: &Config, bulk: bool) -> serde_json::Value {
    let mut message = serde_json::json!({
        "type": "authenticate", "role": "mobile", "accessToken": config.access_token,
        "deviceId": request.device_id, "publicKey": request.public_key,
        "transportVersion": 2, "binaryRelay": true, "tcpPunch": true, "nativeTraversal": true,
        "fileBulkV1": bulk,
        "clientInfo": { "name": "Remote AI PC", "platform": std::env::consts::OS },
    });
    // Both backends treat the presence of resume as a recovery attempt, including null.
    if let Some(resume) = &request.resume {
        message["resume"] = serde_json::json!(resume);
    }
    message
}

struct ClientRuntime {
    auth_renewal: super::auth_renewal::AuthRenewal,
    socket: Socket,
    tcp: super::tcp::ClientSession,
    binary_relay: bool,
    bulk: ClientBulk,
    bridge: Bridge,
    received: Instant,
    pinged: Instant,
    session_id: Option<String>,
}

impl ClientRuntime {
    fn poll(
        mut self,
        mut commands: mpsc::Receiver<ClientCommand>,
        life: Lifecycle,
        mut config: Config,
    ) -> Result<u16, ChatError> {
        loop {
            let current = life.configs.borrow().clone();
            let Some(current) = current.filter(|current| config.same_owner(current)) else {
                return Ok(4001);
            };
            if current.access_token != config.access_token {
                let Some(frame) = self.auth_renewal.request(&current.access_token) else {
                    return Ok(1006);
                };
                self.socket.send(frame).map_err(|_| ChatError::Transport)?;
                config = current;
            }
            self.commands(&mut commands)?;
            self.bulk.flush()?;
            // IPC acknowledges queue admission; finish queued peer-close frames before teardown.
            if life.cancelled.load(Ordering::Acquire) && commands.is_empty() {
                return Ok(1000);
            }
            if self.auth_renewal.timed_out()
                || !self.bridge.flush()
                || self.received.elapsed() > RECEIVE_TIMEOUT
            {
                return Err(ChatError::Transport);
            }
            if self.pinged.elapsed() >= PING_INTERVAL {
                self.socket
                    .send(Message::Ping(Vec::new().into()))
                    .map_err(|_| ChatError::Transport)?;
                self.pinged = Instant::now();
            }
            // Keep servicing IPC acknowledgements and cancellation while the renderer catches up.
            if !self.bulk.has_capacity() {
                std::thread::sleep(POLL_INTERVAL);
                continue;
            }
            if let Some(code) = self.receive()? {
                return Ok(code);
            }
        }
    }

    fn commands(&mut self, commands: &mut mpsc::Receiver<ClientCommand>) -> Result<(), ChatError> {
        for _ in 0..COMMANDS_PER_TICK {
            match commands.try_recv() {
                Ok(ClientCommand::Ack(sequence)) => self.bridge.acknowledge(sequence),
                Ok(ClientCommand::BulkAck(sequence)) => self.bulk.acknowledge(sequence),
                Ok(ClientCommand::Send(message)) => {
                    if self.session_id.as_deref() != Some(message.session_id()) {
                        return Err(ChatError::InvalidFrame);
                    }
                    if let Outgoing::PeerClose { session_id } = &message {
                        self.tcp
                            .receive(
                                &serde_json::json!({"type":"peer-close", "sessionId":session_id}),
                            )
                            .map_err(|_| ChatError::InvalidFrame)?;
                    }
                    let frame = super::wire::encode(&message, self.binary_relay)?;
                    self.socket.send(frame).map_err(|_| ChatError::Transport)?;
                }
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => return Err(ChatError::Transport),
            }
        }
        Ok(())
    }

    fn receive(&mut self) -> Result<Option<u16>, ChatError> {
        match self.socket.read() {
            Ok(Message::Text(text)) => {
                self.received = Instant::now();
                self.message(text.to_string())?;
            }
            Ok(Message::Close(frame)) => {
                return Ok(Some(frame.map_or(1000, |frame| frame.code.into())))
            }
            Ok(Message::Binary(bytes)) => {
                if !self.binary_relay {
                    return Err(ChatError::InvalidFrame);
                }
                self.received = Instant::now();
                if bytes.starts_with(b"CSF1") {
                    self.bulk
                        .enqueue(bytes.to_vec(), self.session_id.as_deref())?;
                } else {
                    self.message(super::wire::decode(&bytes)?)?;
                }
            }
            Ok(Message::Ping(payload)) => {
                self.received = Instant::now();
                self.socket
                    .send(Message::Pong(payload))
                    .map_err(|_| ChatError::Transport)?;
            }
            Ok(_) => self.received = Instant::now(),
            Err(SocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => return Err(ChatError::Transport),
        }
        Ok(None)
    }

    fn message(&mut self, data: String) -> Result<(), ChatError> {
        let frame: serde_json::Value =
            serde_json::from_str(&data).map_err(|_| ChatError::InvalidFrame)?;
        self.auth_renewal.receive(&frame);
        if frame["type"] == "chat-policy" {
            self.binary_relay |= frame["binaryRelay"] == true;
            self.bulk.negotiate(frame["fileBulkV1"] == true);
        }
        if matches!(frame["type"].as_str(), Some("paired" | "resumed")) {
            self.session_id = frame["sessionId"].as_str().map(str::to_owned);
        }
        self.tcp
            .receive(&frame)
            .map_err(|_| ChatError::InvalidFrame)?;
        if !self.bridge.enqueue(Envelope {
            generation: 0,
            event: Event::Message { data },
        }) {
            return Err(ChatError::Transport);
        }
        Ok(())
    }
}

fn dial(url: &str) -> Result<Socket, ChatError> {
    let (mut socket, _) =
        crate::remote_websocket::connect_remote_websocket(url).map_err(|_| ChatError::Transport)?;
    let stream = match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream,
        MaybeTlsStream::Rustls(stream) => &mut stream.sock,
        _ => return Err(ChatError::Transport),
    };
    stream
        .set_read_timeout(Some(POLL_INTERVAL))
        .map_err(|_| ChatError::Transport)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| ChatError::Transport)?;
    socket.set_config(|config| {
        config.max_message_size = Some(FRAME_LIMIT);
        config.max_frame_size = Some(FRAME_LIMIT);
        config.max_write_buffer_size = 2 * FRAME_LIMIT;
        config.write_buffer_size = 0;
    });
    Ok(socket)
}
