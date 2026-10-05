use super::*;

#[test]
fn terminal_owner_is_stable_across_connections_and_cannot_be_supplied_by_a_peer() {
    let mut runtime = connected_identity();
    let delivered = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = delivered.clone();
    runtime.bridge = Some(Bridge::new(
        "terminal-test".into(),
        Box::new(move |batch| {
            captured.lock().unwrap().extend(batch.events);
            true
        }),
    ));
    let peer = |id: &str| {
        json!({ "type": "peer-open", "sessionId": id, "terminalOwner": "forged" }).to_string()
    };
    runtime.receive(&peer("first")).unwrap();
    runtime.config.as_mut().unwrap().access_token = "renewed".into();
    runtime.receive(&peer("second")).unwrap();
    runtime.config.as_mut().unwrap().owner = "another-account".into();
    runtime.receive(&peer("third")).unwrap();
    runtime.bridge.as_mut().unwrap().flush();
    let owners: Vec<_> = delivered
        .lock()
        .unwrap()
        .iter()
        .filter_map(|envelope| match &envelope.event {
            Event::Message { data } => {
                let message: serde_json::Value = serde_json::from_str(data).unwrap();
                Some(message["terminalOwner"].clone())
            }
            _ => None,
        })
        .collect();
    assert_eq!(owners.len(), 3);
    assert_eq!(owners[0], owners[1]);
    assert_ne!(owners[1], owners[2]);
    assert_ne!(owners[0], "forged");
}

#[test]
fn coordinator_updates_upload_limits_and_owner_changes_reset_them() {
    let mut runtime = connected_identity();
    runtime
        .receive(
            &json!({"type": "chat-policy", "policy": {
                "fileUploadMaxMb": 20, "fileUploadTotalMaxMb": 50
            }})
            .to_string(),
        )
        .unwrap();
    assert!(runtime.upload_policy.snapshot().unwrap().message_bytes() > 50 * 1024 * 1024);
    runtime.disconnect();
    assert!(runtime.upload_policy.snapshot().unwrap().message_bytes() > 50 * 1024 * 1024);
    runtime.configure(None);
    assert_eq!(
        runtime.upload_policy.snapshot().unwrap().message_bytes(),
        8 * 1024 * 1024
    );
}

pub(super) fn connected_identity() -> Runtime {
    let mut runtime = Runtime::default();
    runtime.command(Command::Attach {
        client_id: "view".into(),
        deliver: Box::new(|_| true),
    });
    runtime.configure(Some(Config {
        websocket_url: "ws://localhost/device-chat".into(),
        device_id: "pc".into(),
        access_token: "token".into(),
        owner: "owner".into(),
    }));
    runtime
        .sessions
        .receive(
            &json!({ "type": "peer-open", "sessionId": "phone", "transportVersion": 2,
        "resumeToken": "proof", "expiresAt": super::super::sessions::now_ms() + 120_000 }),
        )
        .unwrap();
    runtime.sessions.key_sent("phone");
    runtime
}

#[test]
fn renewal_preserves_resumes_but_logout_and_owner_changes_revoke_them() {
    let mut runtime = connected_identity();
    let mut renewed = runtime.config.clone().unwrap();
    renewed.access_token = "new-token".into();
    runtime.configure(Some(renewed.clone()));
    assert!(runtime.sessions.contains("phone"));
    renewed.owner = "other-owner".into();
    runtime.configure(Some(renewed));
    assert!(!runtime.sessions.contains("phone"));
    let mut runtime = connected_identity();
    runtime.configure(None);
    assert!(!runtime.sessions.contains("phone"));
    assert!(runtime.config.is_none());
}

#[test]
fn forgetting_a_destroyed_key_works_offline_and_across_a_socket_reconnect() {
    let mut runtime = connected_identity();
    let generation = runtime.generation;
    runtime.disconnect();
    runtime.send(SendRequest {
        client_id: "old-view".into(),
        generation,
        message: Outgoing::PeerClose {
            session_id: "phone".into(),
        },
    });
    assert!(runtime.sessions.contains("phone"));
    runtime.send(SendRequest {
        client_id: "view".into(),
        generation,
        message: Outgoing::PeerClose {
            session_id: "phone".into(),
        },
    });
    assert!(!runtime.sessions.contains("phone"));
}

#[test]
fn a_login_change_discards_an_in_flight_dial_before_authenticating() {
    let mut runtime = connected_identity();
    let (sender, receiver) = sync_mpsc::channel();
    runtime.dial = Some((runtime.generation, receiver));
    runtime.configure(None);
    sender.send(Err(ChatError::Transport)).unwrap();
    let reset_generation = runtime.generation;
    runtime.finish_dial();
    assert_eq!(runtime.generation, reset_generation);
    assert!(runtime.dial.is_none());
    assert!(runtime.socket.is_none());
}
