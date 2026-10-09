use super::*;
use std::time::Instant;

const RECORDS: usize = 512;
const CONTROL_INTERVAL: usize = 32;

fn bulk_frame(index: usize) -> Vec<u8> {
    let mut frame = b"CSF1\x0epaired-session".to_vec();
    let mut record = vec![index as u8; 16 * 1024];
    record[..8].copy_from_slice(b"RAB1\x01\x01\x00\x48");
    record[64..68].copy_from_slice(&(16_384u32 - 88).to_be_bytes());
    frame.extend(record);
    frame
}

fn serve_bulk(listener: TcpListener, stopped: sync_mpsc::Receiver<()>) {
    let (stream, _) = listener.accept().unwrap();
    stream.set_nodelay(true).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let mut socket = tungstenite::accept(stream).unwrap();
    let auth: Value = serde_json::from_str(socket.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(auth["fileBulkV1"], true);
    for frame in [
        json!({"type":"chat-policy","binaryRelay":true,"fileBulkV1":true}),
        json!({"type":"paired","sessionId":"paired-session"}),
    ] {
        socket
            .send(Message::Text(frame.to_string().into()))
            .unwrap();
    }
    // Wait until the frontend has received the policy and requested its file.
    assert!(matches!(socket.read().unwrap(), Message::Binary(_)));
    for index in 0..RECORDS {
        socket
            .send(Message::Binary(bulk_frame(index).into()))
            .unwrap();
        if index % CONTROL_INTERVAL == 0 {
            socket
                .send(Message::Text(
                    json!({"type":"progress-probe","index":index})
                        .to_string()
                        .into(),
                ))
                .unwrap();
        }
    }
    stopped.recv_timeout(Duration::from_secs(10)).unwrap();
}

fn acknowledge_controls(peer: &NativePeer) -> usize {
    let mut probes = 0;
    for text in peer.events.try_iter() {
        let batch: Value = serde_json::from_str(&text).unwrap();
        assert!(!text.contains("native-secret"));
        peer.commands
            .blocking_send(ClientCommand::Ack(batch["sequence"].as_u64().unwrap()))
            .unwrap();
        for event in batch["events"].as_array().unwrap() {
            assert_ne!(event["type"], "closed");
            assert!(event.get("bytes").is_none());
            probes += usize::from(
                event["data"]
                    .as_str()
                    .is_some_and(|data| data.contains("progress-probe")),
            );
        }
    }
    probes
}

fn verify_batch(bytes: &[u8], received: &mut usize) -> u64 {
    assert_eq!(&bytes[..4], b"CGR1");
    let sequence = u32::from_be_bytes(bytes[4..8].try_into().unwrap());
    let mut offset = 9;
    assert!((1..=16).contains(&bytes[8]));
    for _ in 0..bytes[8] {
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        offset += 4;
        assert_eq!(&bytes[offset..offset + length], bulk_frame(*received));
        offset += length;
        *received += 1;
    }
    assert_eq!(offset, bytes.len());
    sequence.into()
}

#[test]
fn relay_download_streams_eight_mib_over_raw_ipc_while_delivering_chat_events() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, stopped) = sync_mpsc::channel();
    let server = thread::spawn(move || serve_bulk(listener, stopped));
    let (delivered, bulk_events) = sync_mpsc::channel();
    let channel = Channel::new(move |body| {
        let InvokeResponseBody::Raw(bytes) = body else {
            panic!("expected raw IPC")
        };
        delivered.send(bytes).unwrap();
        Ok(())
    });
    let peer = start_peer_with_bulk(address, None, Some(channel));
    receive_native_frame(&peer, "paired");
    peer.commands
        .blocking_send(ClientCommand::Send(Outgoing::Relay {
            session_id: "paired-session".into(),
            payload: "aabb".into(),
        }))
        .unwrap();
    let started = Instant::now();
    let (mut received, mut probes) = (0, 0);
    while received < RECORDS {
        let bytes = bulk_events.recv_timeout(Duration::from_secs(5)).unwrap();
        let sequence = verify_batch(&bytes, &mut received);
        peer.commands
            .blocking_send(ClientCommand::BulkAck(sequence))
            .unwrap();
        probes += acknowledge_controls(&peer);
    }
    while probes < RECORDS / CONTROL_INTERVAL && started.elapsed() < Duration::from_secs(10) {
        probes += acknowledge_controls(&peer);
        thread::sleep(Duration::from_millis(5));
    }
    eprintln!(
        "8 MiB native relay receive: {:.2} MiB/s",
        8.0 / started.elapsed().as_secs_f64()
    );
    assert_eq!(probes, RECORDS / CONTROL_INTERVAL);
    peer.configs.send_replace(None);
    peer.worker.join().unwrap();
    stop.send(()).unwrap();
    server.join().unwrap();
}
