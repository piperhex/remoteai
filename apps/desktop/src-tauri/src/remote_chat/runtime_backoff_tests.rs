use super::*;
use std::net::TcpListener;

fn wait_until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(
            Instant::now() < deadline,
            "local WebSocket fixture timed out"
        );
        thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn loopback_failures_grow_until_registered_and_preserve_resume_credentials() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("ws://{}/device-chat", listener.local_addr().unwrap());
    let (auth_tx, auth_rx) = sync_mpsc::channel();
    let (release_tx, release_rx) = sync_mpsc::channel();
    let server = thread::spawn(move || {
        for attempt in 0..3 {
            let (stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut socket = tungstenite::accept(stream).unwrap();
            let auth: serde_json::Value =
                serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
            auth_tx.send(auth).unwrap();
            if attempt == 2 {
                socket
                    .send(Message::Text(r#"{"type":"registered"}"#.into()))
                    .unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            }
            // The first two sockets open and receive authenticate, but never acknowledge it.
        }
    });
    let mut runtime = tests::connected_identity();
    runtime.config.as_mut().unwrap().websocket_url = url;
    runtime.backoff = ReconnectBackoff::with_random(1500, || 1.0);
    for expected in [1500, 3000] {
        runtime.retry_at = Instant::now();
        runtime.start_dial();
        let generation = runtime.generation;
        runtime.start_dial(); // A pending dial cannot be replaced by a second one.
        assert_eq!(runtime.generation, generation);
        wait_until(|| {
            runtime.finish_dial();
            runtime.dial.is_none()
        });
        let auth = auth_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(auth["sessions"][0]["sessionId"], "phone");
        wait_until(|| {
            runtime.tick();
            runtime.socket.is_none()
        });
        let remaining = runtime.retry_at.saturating_duration_since(Instant::now());
        assert!(remaining <= Duration::from_millis(expected));
        assert!(remaining > Duration::from_millis(expected - 100));
        assert!(runtime.sessions.contains("phone"));
    }
    runtime.retry_at = Instant::now();
    runtime.start_dial();
    wait_until(|| {
        runtime.finish_dial();
        runtime.dial.is_none()
    });
    wait_until(|| {
        runtime.tick();
        runtime.registered
    });
    runtime.disconnect();
    assert!(
        runtime.retry_at.saturating_duration_since(Instant::now()) <= Duration::from_millis(1500)
    );
    release_tx.send(()).unwrap();
    server.join().unwrap();
    runtime.configure(None);
    runtime.start_dial();
    assert!(runtime.dial.is_none());
    assert!(!runtime.sessions.contains("phone"));
}

#[test]
fn attachment_configuration_and_token_rotation_do_not_count_as_connection_failures() {
    let mut runtime = tests::connected_identity();
    runtime.backoff = ReconnectBackoff::with_random(1500, || 1.0);
    let mut config = runtime.config.clone().unwrap();
    config.access_token = "new-token".into();
    runtime.configure(Some(config));
    assert!(runtime.retry_at <= Instant::now());
    assert_eq!(runtime.backoff.next(), Duration::from_millis(1500));
    runtime.command(Command::Detach("view".into()));
    runtime.start_dial();
    assert!(runtime.dial.is_none());
}

#[test]
fn a_stalled_dial_does_not_block_ticks_detach_or_logout() {
    let mut runtime = tests::connected_identity();
    let (_sender, receiver) = sync_mpsc::channel();
    runtime.dial = Some((runtime.generation, receiver));
    let started = Instant::now();
    for _ in 0..100 {
        runtime.tick();
    }
    runtime.command(Command::Detach("view".into()));
    runtime.configure(None);
    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(runtime.bridge.is_none());
    assert!(runtime.socket.is_none());
}

#[test]
fn replacing_a_failed_host_waits_for_the_old_dial_to_finish() {
    let mut runtime = tests::connected_identity();
    let (sender, receiver) = sync_mpsc::channel();
    runtime.dial = Some((runtime.generation, receiver));
    runtime.fail_host_transport();
    runtime.command(Command::Attach {
        client_id: "replacement".into(),
        bulk: None,
        deliver: Box::new(|_| true),
    });
    let old_generation = runtime.dial.as_ref().unwrap().0;
    runtime.start_dial();
    assert_eq!(runtime.dial.as_ref().unwrap().0, old_generation);
    sender.send(Err(ChatError::Transport)).unwrap();
    let generation = runtime.generation;
    runtime.finish_dial();
    assert!(runtime.dial.is_none());
    assert_eq!(runtime.generation, generation);
    assert!(runtime.socket.is_none());
}
