use super::*;
use serde_json::{json, Value};
use std::{
    net::{SocketAddr, TcpListener},
    sync::mpsc as sync_mpsc,
    thread,
    time::Duration,
};
use tauri::ipc::InvokeResponseBody;
use tungstenite::Message;

#[path = "client_renewal_tests.rs"]
mod renewal_tests;

#[path = "client_bulk_runtime_tests.rs"]
mod bulk_runtime_tests;

fn request() -> OpenRequest {
    OpenRequest {
        client_id: uuid::Uuid::new_v4().to_string(),
        device_id: "other-pc".into(),
        identity: crate::cloud::GuiCloudIdentity {
            base_url: "https://example.test/api".into(),
            user_id: "owner".into(),
        },
        public_key: "ab".repeat(32),
        resume: None,
        bulk_events: None,
    }
}

fn connection_handle() -> (ConnectionHandle, mpsc::Receiver<ClientCommand>) {
    let (commands, receiver) = mpsc::channel(8);
    (
        ConnectionHandle {
            commands,
            cancelled: Arc::new(AtomicBool::new(false)),
        },
        receiver,
    )
}

#[test]
fn remote_computers_keep_independent_connections_and_command_queues() {
    let mut connections = ClientConnections::default();
    let (office, mut office_commands) = connection_handle();
    let office_cancelled = office.cancelled.clone();
    let (home, mut home_commands) = connection_handle();
    let home_cancelled = home.cancelled.clone();
    connections.insert("office".into(), office);
    connections.insert("home".into(), home);
    assert!(!office_cancelled.load(Ordering::Acquire));
    assert!(!home_cancelled.load(Ordering::Acquire));
    connections
        .sender("office")
        .unwrap()
        .try_send(ClientCommand::Ack(7))
        .unwrap();
    assert!(matches!(
        office_commands.try_recv(),
        Ok(ClientCommand::Ack(7))
    ));
    assert!(matches!(
        home_commands.try_recv(),
        Err(mpsc::error::TryRecvError::Empty)
    ));

    connections.close("office");
    connections.close("unknown");
    assert!(office_cancelled.load(Ordering::Acquire));
    assert!(connections.sender("office").is_none());
    assert!(!home_cancelled.load(Ordering::Acquire));
    connections
        .sender("home")
        .unwrap()
        .try_send(ClientCommand::Ack(9))
        .unwrap();
    assert!(matches!(
        home_commands.try_recv(),
        Ok(ClientCommand::Ack(9))
    ));
}

#[test]
fn finished_worker_cannot_remove_its_replacement_or_another_computer() {
    let mut connections = ClientConnections::default();
    let (old, _old_commands) = connection_handle();
    let old_cancelled = old.cancelled.clone();
    let (replacement, _replacement_commands) = connection_handle();
    let replacement_cancelled = replacement.cancelled.clone();
    let (other, _other_commands) = connection_handle();
    connections.insert("office".into(), old);
    connections.insert("home".into(), other);
    connections.insert("office".into(), replacement);
    assert!(old_cancelled.load(Ordering::Acquire));
    connections.finished("office", &old_cancelled);
    assert!(connections.sender("office").is_some());
    assert!(!replacement_cancelled.load(Ordering::Acquire));
    connections.finished("office", &replacement_cancelled);
    assert!(connections.sender("office").is_none());
    assert!(connections.sender("home").is_some());
}

#[test]
fn native_remote_gui_is_bound_to_the_logged_in_owner_and_server() {
    let request = request();
    let config = Config {
        websocket_url: "wss://example.test/api/device-chat".into(),
        access_token: "secret".into(),
        device_id: "this-pc".into(),
        owner: "\"owner\"".into(),
    };
    assert!(request.matches(&config));
    assert!(!request.matches(&Config {
        owner: "\"other-owner\"".into(),
        ..config.clone()
    }));
    assert!(!request.matches(&Config {
        websocket_url: "wss://elsewhere.test/device-chat".into(),
        ..config.clone()
    }));
    assert!(!request.matches(&Config {
        device_id: "other-pc".into(),
        ..config
    }));
}

#[test]
fn native_remote_gui_validates_peer_keys_and_resume_limits() {
    let mut request = request();
    assert!(request.validate());
    request.public_key = "z".repeat(64);
    assert!(!request.validate());
    request.public_key = "ab".repeat(31);
    assert!(!request.validate());
    request.public_key = "ab".repeat(32);
    request.resume = Some(ResumeRequest {
        session_id: "session".into(),
        resume_token: "token".into(),
    });
    assert!(request.validate());
    request.resume.as_mut().unwrap().resume_token = "t".repeat(513);
    assert!(!request.validate());
    request.resume = None;
    request.client_id = "unknown-window".into();
    assert!(!request.validate());
}

#[test]
fn native_bulk_callback_uses_tauris_channel_id_and_legacy_requests_can_omit_it() {
    let mut value = json!({"clientId":uuid::Uuid::new_v4(),"deviceId":"other-pc",
        "identity":{"baseUrl":"https://example.test","userId":"owner"},"publicKey":"ab".repeat(32)});
    assert!(serde_json::from_value::<OpenRequest>(value.clone())
        .unwrap()
        .bulk_events
        .is_none());
    value["bulkEvents"] = json!("__CHANNEL__:17");
    assert!(serde_json::from_value::<OpenRequest>(value.clone())
        .unwrap()
        .bulk_events
        .is_some());
    value["bulkEvents"] = json!("arbitrary-callback");
    assert!(serde_json::from_value::<OpenRequest>(value).is_err());
}

#[test]
fn native_peer_authenticates_routes_its_session_and_closes_after_logout() {
    exercise_native_peer(None);
}

#[test]
fn native_peer_resumes_with_its_original_proof_and_routes_its_session() {
    exercise_native_peer(Some(ResumeRequest {
        session_id: "paired-session".into(),
        resume_token: "cd".repeat(32),
    }));
}

fn serve_peer(
    listener: TcpListener,
    expected_resume: Option<Value>,
    relayed: sync_mpsc::Sender<()>,
    stopped: sync_mpsc::Receiver<()>,
) {
    let (stream, _) = listener.accept().unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut socket = tungstenite::accept(stream).unwrap();
    let auth: Value = serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(auth["type"], "authenticate");
    assert_eq!(auth["accessToken"], "native-secret");
    assert_eq!(auth["deviceId"], "other-pc");
    assert_eq!(auth["role"], "mobile");
    assert_eq!(auth["publicKey"], "ab".repeat(32));
    assert_eq!(auth["transportVersion"], 2);
    assert_eq!(auth["tcpPunch"], true);
    assert_eq!(auth.get("resume"), expected_resume.as_ref());
    let event = if expected_resume.is_some() {
        "resumed"
    } else {
        "paired"
    };
    socket
        .send(Message::Text(
            json!({"type": event, "sessionId": "paired-session"})
                .to_string()
                .into(),
        ))
        .unwrap();
    let frame: Value = serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(
        frame,
        json!({"type":"relay", "sessionId":"paired-session", "payload":"aabb"})
    );
    relayed.send(()).unwrap();
    stopped.recv_timeout(Duration::from_secs(5)).unwrap();
}

fn exercise_native_peer(resume: Option<ResumeRequest>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (relayed, relay_received) = sync_mpsc::channel();
    let (stop_server, stopped) = sync_mpsc::channel();
    let expected_resume = resume.as_ref().map(|proof| json!(proof));
    let server = thread::spawn(move || serve_peer(listener, expected_resume, relayed, stopped));
    let peer = start_peer(address, resume);
    let text = peer.events.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(!text.contains("native-secret"));
    assert!(text.contains("paired-session"));
    peer.commands
        .blocking_send(ClientCommand::Send(Outgoing::Relay {
            session_id: "paired-session".into(),
            payload: "aabb".into(),
        }))
        .unwrap();
    relay_received.recv_timeout(Duration::from_secs(5)).unwrap();
    peer.configs.send_replace(None);
    let closed: Value =
        serde_json::from_str(&peer.events.recv_timeout(Duration::from_secs(5)).unwrap()).unwrap();
    assert_eq!(closed["events"][0]["code"], 4001);
    stop_server.send(()).unwrap();
    peer.worker.join().unwrap();
    server.join().unwrap();
}

struct NativePeer {
    configs: watch::Sender<Option<Config>>,
    commands: mpsc::Sender<ClientCommand>,
    events: sync_mpsc::Receiver<String>,
    worker: thread::JoinHandle<()>,
    tcp_authority: Arc<super::super::tcp::Authority>,
}

fn start_peer(address: SocketAddr, resume: Option<ResumeRequest>) -> NativePeer {
    start_peer_with_bulk(address, resume, None)
}

fn start_peer_with_bulk(
    address: SocketAddr,
    resume: Option<ResumeRequest>,
    bulk_events: Option<Channel<tauri::ipc::Response>>,
) -> NativePeer {
    let config = Config {
        websocket_url: format!("ws://{address}/device-chat"),
        access_token: "native-secret".into(),
        device_id: "this-pc".into(),
        owner: "\"owner\"".into(),
    };
    let (configs, receiver) = watch::channel(Some(config));
    let (commands, command_receiver) = mpsc::channel(8);
    let (delivered, events) = sync_mpsc::channel();
    let channel = Channel::new(move |body| {
        if let InvokeResponseBody::Json(text) = body {
            delivered.send(text).unwrap();
        }
        Ok(())
    });
    let mut request = request();
    request.identity.base_url = format!("http://{address}");
    request.resume = resume;
    let tcp_authority = Arc::default();
    let worker_authority = Arc::clone(&tcp_authority);
    let worker = thread::spawn(move || {
        super::super::client_runtime::run(
            request,
            channel,
            command_receiver,
            super::super::client_runtime::Lifecycle {
                configs: receiver,
                cancelled: Arc::new(AtomicBool::new(false)),
                tcp_authority: worker_authority,
                bulk_events,
            },
        )
    });
    NativePeer {
        configs,
        commands,
        events,
        worker,
        tcp_authority,
    }
}

#[test]
fn native_peer_installs_tcp_permissions_before_forwarding_and_revokes_on_logout() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, stopped) = sync_mpsc::channel();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut socket = tungstenite::accept(stream).unwrap();
        let auth: Value =
            serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
        assert_eq!(auth["tcpPunch"], true);
        socket
            .send(Message::Text(
                json!({"type":"paired","sessionId":"paired-session",
            "expiresAt":u64::MAX,"tcpPunch":{"servers":[{"host":"discovery.example","port":3478}]}})
                .to_string()
                .into(),
            ))
            .unwrap();
        stopped.recv_timeout(Duration::from_secs(5)).unwrap();
    });
    let peer = start_peer(address, None);
    receive_native_frame(&peer, "paired");
    // Delivery to the frontend must follow authorization; logout must remove the grant.
    assert!(peer.tcp_authority.has_client_session("paired-session"));
    peer.configs.send_replace(None);
    peer.worker.join().unwrap();
    assert!(!peer.tcp_authority.has_client_session("paired-session"));
    stop.send(()).unwrap();
    server.join().unwrap();
}

#[test]
fn native_peer_negotiates_binary_relay_and_delivers_it_through_ipc() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, stopped) = sync_mpsc::channel();
    let server = thread::spawn(move || serve_binary_peer(listener, stopped));
    let peer = start_peer(address, None);
    receive_native_frame(&peer, "paired");
    peer.commands
        .blocking_send(ClientCommand::Send(Outgoing::Relay {
            session_id: "paired-session".into(),
            payload: "00abff".into(),
        }))
        .unwrap();
    let frame = receive_native_frame(&peer, "relay");
    assert_eq!(frame["payload"], "00abff");
    assert_eq!(frame["sessionId"], "paired-session");
    peer.configs.send_replace(None);
    stop.send(()).unwrap();
    peer.worker.join().unwrap();
    server.join().unwrap();
}

fn receive_native_frame(peer: &NativePeer, kind: &str) -> Value {
    loop {
        let text = peer.events.recv_timeout(Duration::from_secs(5)).unwrap();
        let batch: Value = serde_json::from_str(&text).unwrap();
        peer.commands
            .blocking_send(ClientCommand::Ack(batch["sequence"].as_u64().unwrap()))
            .unwrap();
        for event in batch["events"].as_array().unwrap() {
            if let Some(data) = event["data"].as_str() {
                let frame: Value = serde_json::from_str(data).unwrap();
                if frame["type"] == kind {
                    return frame;
                }
            }
        }
    }
}

fn serve_binary_peer(listener: TcpListener, stopped: sync_mpsc::Receiver<()>) {
    let (stream, _) = listener.accept().unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut socket = tungstenite::accept(stream).unwrap();
    let auth: Value = serde_json::from_str(&socket.read().unwrap().into_text().unwrap()).unwrap();
    assert_eq!(auth["binaryRelay"], true);
    assert_eq!(auth["fileBulkV1"], false);
    for frame in [
        json!({"type": "chat-policy", "binaryRelay": true, "policy": {}}),
        json!({"type": "paired", "sessionId": "paired-session"}),
    ] {
        socket
            .send(Message::Text(frame.to_string().into()))
            .unwrap();
    }
    let frame = socket.read().unwrap();
    assert!(matches!(frame, Message::Binary(_)));
    socket.send(frame).unwrap();
    stopped.recv_timeout(Duration::from_secs(5)).unwrap();
}
