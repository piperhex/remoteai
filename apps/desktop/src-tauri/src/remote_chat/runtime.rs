use std::{
    io::ErrorKind,
    net::TcpStream,
    sync::mpsc as sync_mpsc,
    thread,
    time::{Duration, Instant},
};

use crate::codex_gui::upload_policy::UploadPolicyStore;
use crate::remote_websocket::backoff::ReconnectBackoff;
use serde_json::json;
use std::sync::Arc;
use tungstenite::{stream::MaybeTlsStream, Error as SocketError, Message, WebSocket};

use super::{
    bridge::Bridge,
    config::Config,
    host_health::Health,
    protocol::{ChatError, Command, Envelope, Event, Outgoing, FRAME_LIMIT},
    sessions::Sessions,
    SendRequest,
};

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;
type Dial = sync_mpsc::Receiver<Result<Socket, ChatError>>;
#[path = "runtime_socket.rs"]
mod socket;
#[path = "runtime_worker.rs"]
mod worker;
pub(super) use worker::run;
#[cfg(test)]
#[path = "runtime_backoff_tests.rs"]
mod backoff_tests;
#[path = "runtime_bulk.rs"]
mod binary;
#[cfg(test)]
#[path = "bulk_runtime_tests.rs"]
mod bulk_tests;
#[path = "runtime_recovery.rs"]
mod recovery;
#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const PING_INTERVAL: Duration = Duration::from_secs(20);
const RECEIVE_TIMEOUT: Duration = Duration::from_secs(60);
const AUTH_TIMEOUT: Duration = Duration::from_secs(10);

struct ConnectionTimes {
    opened: Instant,
    received: Instant,
    pinged: Instant,
}

pub(super) struct Runtime {
    health: Arc<Health>,
    bulk: super::client_bulk::ClientBulk,
    auth_renewal: super::auth_renewal::AuthRenewal,
    tcp_authority: Arc<super::tcp::Authority>,
    upload_policy: Arc<UploadPolicyStore>,
    config: Option<Config>,
    bridge: Option<Bridge>,
    socket: Option<Socket>,
    dial: Option<(u64, Dial)>,
    generation: u64,
    sessions: Sessions,
    retry_at: Instant,
    backoff: ReconnectBackoff,
    times: ConnectionTimes,
    registered: bool,
    binary_relay: bool,
    binary_bulk: bool,
}

impl Default for Runtime {
    fn default() -> Self {
        let now = Instant::now();
        Self {
            health: Arc::default(),
            bulk: super::client_bulk::ClientBulk::new(None),
            auth_renewal: super::auth_renewal::AuthRenewal::default(),
            tcp_authority: Arc::default(),
            upload_policy: Arc::default(),
            config: None,
            bridge: None,
            socket: None,
            dial: None,
            generation: 0,
            sessions: Sessions::default(),
            retry_at: now,
            backoff: ReconnectBackoff::new(1500),
            registered: false,
            binary_relay: false,
            binary_bulk: false,
            times: ConnectionTimes {
                opened: now,
                received: now,
                pinged: now,
            },
        }
    }
}

impl Runtime {
    pub(super) fn new(
        upload_policy: Arc<UploadPolicyStore>,
        tcp_authority: Arc<super::tcp::Authority>,
        health: Arc<Health>,
    ) -> Self {
        Self {
            upload_policy,
            tcp_authority,
            health,
            ..Self::default()
        }
    }

    pub(super) fn command(&mut self, command: Command) {
        match command {
            Command::Attach {
                client_id,
                deliver,
                bulk,
            } => {
                self.bulk = super::client_bulk::ClientBulk::new(bulk);
                self.bridge = Some(Bridge::new(client_id, deliver));
                self.health.attached();
                self.reset();
                self.retry_at = Instant::now();
            }
            Command::Detach(id) if self.is_client(&id) => {
                self.reset();
                self.bridge = None;
            }
            Command::Reconnect(request)
                if self.is_client(&request.client_id) && request.generation == self.generation =>
            {
                if request.reset {
                    self.reset();
                    self.schedule_retry();
                } else if self.socket.is_some() {
                    self.disconnect();
                }
            }
            Command::Ack(request) if self.is_client(&request.client_id) => {
                if let Some(bridge) = self.bridge.as_mut() {
                    bridge.acknowledge(request.sequence);
                }
            }
            Command::BulkAck(request) if self.is_client(&request.client_id) => {
                self.bulk.acknowledge(request.sequence);
            }
            Command::Send(request) => self.send(request),
            Command::Bulk(request) => self.send_bulk(request),
            _ => {}
        }
    }

    fn is_client(&self, id: &str) -> bool {
        self.bridge
            .as_ref()
            .is_some_and(|bridge| bridge.client_id == id)
    }

    pub(super) fn configure(&mut self, config: Option<Config>) {
        if self.config == config {
            return;
        }
        let same_owner = self
            .config
            .as_ref()
            .zip(config.as_ref())
            .is_some_and(|(old, new)| old.same_owner(new));
        self.config = config;
        if same_owner {
            self.renew_authentication();
        } else {
            self.reset();
            if self.upload_policy.update(&json!({})).is_err() {
                eprintln!("remote chat: could not reset upload policy");
            }
        }
        self.retry_at = Instant::now();
    }

    fn renew_authentication(&mut self) {
        let frame = self
            .config
            .as_ref()
            .filter(|_| self.registered)
            .and_then(|config| self.auth_renewal.request(&config.access_token));
        if frame.is_some_and(|frame| self.write(frame).is_ok()) {
            return;
        }
        // Older coordinators still require a resumable reconnect to extend their expiry timer.
        self.clear_connection();
    }

    fn emit(&mut self, event: Event) {
        let envelope = Envelope {
            generation: self.generation,
            event,
        };
        if self
            .bridge
            .as_mut()
            .is_some_and(|bridge| !bridge.enqueue(envelope))
        {
            // Resume credentials are unsafe after dropping application frames. Start a fresh session.
            self.reset();
            self.schedule_retry();
        }
    }

    fn disconnect(&mut self) {
        self.clear_connection();
        self.schedule_retry();
    }

    fn schedule_retry(&mut self) {
        self.retry_at = Instant::now() + self.backoff.next();
    }

    fn clear_connection(&mut self) {
        self.socket = None;
        self.generation += 1;
        self.registered = false;
        // Pairing may have arrived while the WebView was paused. Such peers do not yet have
        // usable encryption keys and must not be claimed on a replacement connection.
        for session_id in self.sessions.disconnected() {
            if let Err(error) = self.tcp_authority.remove(&session_id) {
                eprintln!("TCP path cleanup: {error}");
            }
            self.emit(Event::Message {
                data: json!({ "type": "peer-close", "sessionId": session_id }).to_string(),
            });
        }
        self.emit(Event::Disconnected);
    }

    fn reset(&mut self) {
        self.bulk.clear();
        self.socket = None;
        self.generation += 1;
        self.registered = false;
        self.sessions.clear();
        if let Err(error) = self.tcp_authority.clear() {
            eprintln!("TCP paths reset: {error}");
        }
        if let Some(bridge) = self.bridge.as_mut() {
            bridge.reset(self.generation);
        }
    }

    pub(super) fn tick(&mut self) {
        if self.recover_stalled_ipc(Instant::now()) {
            return;
        }
        self.finish_dial();
        if self.bridge.as_mut().is_some_and(|bridge| !bridge.flush()) {
            self.fail_host_transport();
            return;
        }
        self.start_dial();
        if self.socket.is_none() {
            return;
        }
        if self.bulk.flush().is_err() {
            self.fail_host_transport();
            return;
        }
        if !self.bulk.has_capacity() {
            // Backpressure stays on the worker; IPC acknowledgements continue on the next tick.
            thread::sleep(POLL_INTERVAL);
            return;
        }
        if self.read().is_err() {
            // A permanent close already reset sessions and scheduled this failure once.
            if self.socket.is_some() {
                self.disconnect();
            }
            return;
        }
        let now = Instant::now();
        if self.auth_renewal.timed_out()
            || now.duration_since(self.times.received) > RECEIVE_TIMEOUT
            || (!self.registered && now.duration_since(self.times.opened) > AUTH_TIMEOUT)
        {
            self.disconnect();
            return;
        }
        if now.duration_since(self.times.pinged) >= PING_INTERVAL {
            self.times.pinged = now;
            if self.write(Message::Ping(Vec::new().into())).is_err() {
                self.disconnect();
            }
        }
    }

    fn read(&mut self) -> Result<(), ChatError> {
        let Some(socket) = self.socket.as_mut() else {
            return Ok(());
        };
        match socket.read() {
            Ok(Message::Text(text)) => {
                self.times.received = Instant::now();
                self.receive(text.as_str())?;
            }
            Ok(Message::Ping(payload)) => {
                self.times.received = Instant::now();
                self.write(Message::Pong(payload))?;
            }
            Ok(Message::Pong(_)) => self.times.received = Instant::now(),
            Ok(Message::Close(frame)) => {
                if frame.is_some_and(|frame| matches!(u16::from(frame.code), 4000 | 4001)) {
                    self.reset();
                    self.schedule_retry();
                }
                return Err(ChatError::Transport);
            }
            Err(SocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Ok(Message::Binary(bytes)) if self.binary_relay => {
                self.times.received = Instant::now();
                if bytes.starts_with(b"CSF1") {
                    self.receive_bulk(bytes.to_vec())?;
                } else {
                    self.receive(&super::wire::decode(&bytes)?)?;
                }
            }
            Err(_) | Ok(Message::Binary(_)) => return Err(ChatError::Transport),
            Ok(_) => {}
        }
        Ok(())
    }

    fn receive(&mut self, text: &str) -> Result<(), ChatError> {
        if text.len() > FRAME_LIMIT {
            return Err(ChatError::InvalidFrame);
        }
        let mut message: serde_json::Value =
            serde_json::from_str(text).map_err(|_| ChatError::InvalidFrame)?;
        self.auth_renewal.receive(&message);
        if message["type"] == "chat-policy" {
            self.binary_relay |= message["binaryRelay"] == true;
            self.binary_bulk = message["fileBulkV1"] == true;
            self.bulk.negotiate(self.binary_bulk);
            self.upload_policy
                .update(&message["policy"])
                .map_err(|_| ChatError::InvalidFrame)?;
        }
        self.sessions.receive(&message)?;
        self.tcp_authority
            .receive(&message)
            .map_err(|_| ChatError::InvalidFrame)?;
        if message["type"] == "registered" {
            self.registered = true;
            self.backoff.reset();
        } else {
            let data = if message["type"] == "peer-open" {
                let config = self.config.as_ref().ok_or(ChatError::Transport)?;
                // Stable across reconnects; a different account or server cannot attach old terminals.
                message["terminalOwner"] =
                    json!(
                        json!([config.websocket_url, config.owner, config.device_id]).to_string()
                    );
                message.to_string()
            } else {
                text.to_owned()
            };
            self.emit(Event::Message { data });
        }
        Ok(())
    }

    fn send(&mut self, request: SendRequest) {
        if !self.is_client(&request.client_id)
            || !self.sessions.contains(request.message.session_id())
        {
            return;
        }
        if let Outgoing::PeerClose { session_id } = &request.message {
            // A local expiry may race a native reconnect. Never resume keys that the frontend destroyed.
            // Session UUIDs are not reused across owners, so forgetting is safe across socket generations.
            self.sessions.remove(session_id);
            if let Err(error) = self.tcp_authority.remove(session_id) {
                eprintln!("TCP path cleanup: {error}");
            }
        } else if request.generation != self.generation {
            return;
        }
        if self.socket.is_none() {
            return;
        }
        let Ok(frame) = super::wire::encode(&request.message, self.binary_relay) else {
            return;
        };
        if self.write(frame).is_err() {
            self.disconnect();
        } else if matches!(&request.message, Outgoing::Signal { payload, .. } if payload["kind"] == "key")
        {
            self.sessions.key_sent(request.message.session_id());
        }
    }

    fn write(&mut self, message: Message) -> Result<(), ChatError> {
        self.socket
            .as_mut()
            .ok_or(ChatError::Transport)?
            .send(message)
            .map_err(|_| ChatError::Transport)
    }
}
