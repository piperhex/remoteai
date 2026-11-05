//! File sockets use the same cloud endpoint and proxy dialer, with independent queues and cancellation.
use super::super::client::FileOpenRequest;
use super::*;

pub(in crate::remote_chat) fn run_file(
    request: FileOpenRequest,
    events: Channel<Batch>,
    commands: mpsc::Receiver<ClientCommand>,
    life: Lifecycle,
) {
    let code = connect_file(&request, events.clone(), commands, life).unwrap_or(1006);
    // A destroyed WebView has no receiver to notify.
    let _receiver_gone = events.send(Batch {
        sequence: 0,
        events: vec![Envelope {
            generation: 0,
            event: Event::Closed { code },
        }],
    });
}

fn connect_file(
    request: &FileOpenRequest,
    events: Channel<Batch>,
    commands: mpsc::Receiver<ClientCommand>,
    life: Lifecycle,
) -> Result<u16, ChatError> {
    let config = life.configs.borrow().clone().ok_or(ChatError::Transport)?;
    let mut socket = dial(&format!("{}?channel=file", config.websocket_url))?;
    if life.cancelled.load(Ordering::Acquire) {
        return Ok(1000);
    }
    socket.send(Message::Text(serde_json::json!({
        "type": "file-relay-authenticate", "sessionId": request.session_id, "ticket": request.ticket,
    }).to_string().into())).map_err(|_| ChatError::Transport)?;
    let now = Instant::now();
    ClientRuntime {
        file_only: true,
        auth_renewal: super::super::auth_renewal::AuthRenewal::default(),
        socket,
        tcp: super::super::tcp::ClientSession::new(
            life.tcp_authority.clone(),
            request.client_id.clone(),
        ),
        binary_relay: false,
        bulk: ClientBulk::new(life.bulk_events.clone())
            .with_port_streams(life.port_streams.clone()),
        bridge: Bridge::new(
            request.client_id.clone(),
            Box::new(move |batch| events.send(batch).is_ok()),
        ),
        received: now,
        pinged: now,
        session_id: Some(request.session_id.clone()),
    }
    .poll(commands, life, config)
}
