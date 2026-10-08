use super::*;

#[test]
fn native_viewer_renews_and_relays_on_the_original_socket() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (relayed, relay_received) = sync_mpsc::channel();
    let (stop, stopped) = sync_mpsc::channel();
    let server = thread::spawn(move || serve_renewal(listener, relayed, stopped));
    let peer = start_peer(address, None);
    loop {
        let event = peer.events.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(!event.contains("native-secret"));
        let batch: Value = serde_json::from_str(&event).unwrap();
        peer.commands
            .blocking_send(ClientCommand::Ack(batch["sequence"].as_u64().unwrap()))
            .unwrap();
        if event.contains("paired-session") {
            break;
        }
    }
    let mut config = peer.configs.borrow().clone().unwrap();
    config.access_token = "renewed-native-secret".into();
    peer.configs.send_replace(Some(config));
    peer.commands
        .blocking_send(ClientCommand::Send(Outgoing::Relay {
            session_id: "paired-session".into(),
            payload: "aabb".into(),
        }))
        .unwrap();
    relay_received.recv_timeout(Duration::from_secs(5)).unwrap();
    peer.configs.send_replace(None);
    peer.worker.join().unwrap();
    stop.send(()).unwrap();
    server.join().unwrap();
    for event in peer.events.try_iter() {
        assert!(!event.contains("renewed-native-secret"));
        assert!(!event.contains("1006"));
    }
}

fn serve_renewal(
    listener: TcpListener,
    relayed: sync_mpsc::Sender<()>,
    stopped: sync_mpsc::Receiver<()>,
) {
    let (stream, _) = listener.accept().unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut socket = tungstenite::accept(stream).unwrap();
    let auth: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(auth["accessToken"], "native-secret");
    for frame in [
        json!({"type": "chat-policy", "authRenewal": true}),
        json!({"type": "paired", "sessionId": "paired-session"}),
    ] {
        socket
            .send(Message::Text(frame.to_string().into()))
            .unwrap();
    }
    let mut renewed = false;
    let mut delivered = false;
    while !renewed || !delivered {
        let frame: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
        if frame["type"] == "renew-auth" {
            assert_eq!(frame["accessToken"], "renewed-native-secret");
            renewed = true;
            socket
                .send(Message::Text(
                    json!({"type": "auth-renewed"}).to_string().into(),
                ))
                .unwrap();
        } else {
            assert_eq!(
                frame,
                json!({"type": "relay", "sessionId": "paired-session", "payload": "aabb"})
            );
            delivered = true;
        }
    }
    relayed.send(()).unwrap();
    stopped.recv_timeout(Duration::from_secs(5)).unwrap();
}
