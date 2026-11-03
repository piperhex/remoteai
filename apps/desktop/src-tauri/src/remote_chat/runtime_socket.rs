//! Dialing and authentication run on the host worker, never the UI thread.
use super::*;

impl Runtime {
    pub(super) fn start_dial(&mut self) {
        if self.socket.is_some()
            || self.dial.is_some()
            || self.bridge.is_none()
            || Instant::now() < self.retry_at
        {
            return;
        }
        let Some(config) = self.config.as_ref() else {
            return;
        };
        let url = config.websocket_url.clone();
        let (sender, receiver) = sync_mpsc::channel();
        self.dial = Some((self.generation, receiver));
        // DNS, proxy CONNECT and TLS may block. Control commands remain responsive while dialing.
        thread::spawn(move || {
            let socket = dial(&url);
            // A closed receiver means the host stopped while the connection was being established.
            if sender.send(socket).is_err() {
                eprintln!("remote chat: canceled connection attempt");
            }
        });
    }

    pub(super) fn finish_dial(&mut self) {
        let Some((generation, receiver)) = &self.dial else {
            return;
        };
        let result = match receiver.try_recv() {
            Ok(result) => result,
            Err(sync_mpsc::TryRecvError::Empty) => return,
            Err(sync_mpsc::TryRecvError::Disconnected) => Err(ChatError::Transport),
        };
        let generation = *generation;
        self.dial = None;
        if generation != self.generation || self.bridge.is_none() {
            return;
        }
        match result.and_then(|socket| self.authenticate(socket)) {
            Ok(()) => {}
            Err(_) => self.disconnect(),
        }
    }

    pub(super) fn authenticate(&mut self, mut socket: Socket) -> Result<(), ChatError> {
        self.auth_renewal = crate::remote_chat::auth_renewal::AuthRenewal::default();
        self.binary_relay = false;
        self.binary_bulk = false;
        let config = self.config.as_ref().ok_or(ChatError::Transport)?;
        let frame = json!({ "type": "authenticate", "role": "desktop", "transportVersion": 2,
            "binaryRelay": true, "fileBulkV1": true,
            "tcpPunch": true,
            "nativeTraversal": true,
            "remoteAssistance": cfg!(any(windows, target_os = "macos")),
            "accessToken": config.access_token, "deviceId": config.device_id,
            "sessions": self.sessions.authentication() });
        socket
            .send(Message::Text(frame.to_string().into()))
            .map_err(|_| ChatError::Transport)?;
        let now = Instant::now();
        self.times = ConnectionTimes {
            opened: now,
            received: now,
            pinged: now,
        };
        self.socket = Some(socket);
        // Resume notifications can precede `registered`; their encrypted probes must be writable.
        self.emit(Event::Ready);
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
