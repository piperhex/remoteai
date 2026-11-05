use super::*;

#[test]
fn file_socket_authenticates_with_capability_and_receives_raw_bytes_without_chat_credentials() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, stopped) = sync_mpsc::channel();
    let session = uuid::Uuid::new_v4().to_string();
    let ticket = uuid::Uuid::new_v4().to_string();
    let (expected_session, expected_ticket) = (session.clone(), ticket.clone());
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut socket = tungstenite::accept_hdr(
            stream,
            |request: &tungstenite::handshake::server::Request, response| {
                assert_eq!(request.uri(), "/device-chat?channel=file");
                Ok(response)
            },
        )
        .unwrap();
        let auth: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(
            auth,
            json!({"type":"file-relay-authenticate", "sessionId":expected_session, "ticket":expected_ticket})
        );
        socket
            .send(Message::Text(
                json!({"type":"file-relay-ready", "sessionId":expected_session,
            "fileBulkV1":true})
                .to_string()
                .into(),
            ))
            .unwrap();
        let mut bytes = b"CSF1".to_vec();
        bytes.push(expected_session.len() as u8);
        bytes.extend(expected_session.as_bytes());
        let mut record = vec![1; 89];
        record[..8].copy_from_slice(b"RAB1\x01\x01\x00\x48");
        record[60..64].fill(0);
        record[64..68].copy_from_slice(&1u32.to_be_bytes());
        bytes.extend(record);
        socket.send(Message::Binary(bytes.into())).unwrap();
        stopped.recv_timeout(Duration::from_secs(5)).unwrap();
    });
    let config = Config {
        websocket_url: format!("ws://{address}/device-chat"),
        access_token: "native-secret".into(),
        device_id: "this-pc".into(),
        owner: "owner".into(),
    };
    let (configs, receiver) = watch::channel(Some(config));
    let (commands, command_receiver) = mpsc::channel(8);
    let (delivered, received) = sync_mpsc::channel();
    let bulk = Channel::new(move |body| {
        if let InvokeResponseBody::Raw(bytes) = body {
            delivered.send(bytes).unwrap();
        }
        Ok(())
    });
    let request: FileOpenRequest = serde_json::from_value(json!({"clientId":uuid::Uuid::new_v4(),
        "sessionId":session, "ticket":ticket, "bulkEvents":"__CHANNEL__:17"}))
    .unwrap();
    let worker = thread::spawn(move || {
        crate::remote_chat::client_runtime::run_file(
            request,
            Channel::new(|_| Ok(())),
            command_receiver,
            crate::remote_chat::client_runtime::Lifecycle {
                configs: receiver,
                cancelled: Arc::new(AtomicBool::new(false)),
                tcp_authority: Arc::default(),
                bulk_events: Some(bulk),
                port_streams: Arc::default(),
            },
        )
    });
    let batch = received.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(&batch[..4], b"CGR1");
    assert_eq!(batch[8], 1);
    assert!(!String::from_utf8_lossy(&batch).contains("native-secret"));
    configs.send_replace(None);
    worker.join().unwrap();
    drop(commands);
    stop.send(()).unwrap();
    server.join().unwrap();
}
