use super::*;
use std::net::TcpListener;
use tokio::sync::oneshot;
use tungstenite::protocol::Role;

fn wire_frame() -> Vec<u8> {
    let mut frame = b"CSF1\x05phone".to_vec();
    let mut record = vec![7; 16 * 1024];
    record[..8].copy_from_slice(b"RAB1\x01\x01\x00\x48");
    record[64..68].copy_from_slice(&(16_384u32 - 88).to_be_bytes());
    frame.extend(record);
    frame
}

fn request(
    runtime: &Runtime,
    frames: Vec<Vec<u8>>,
) -> (
    super::super::bulk::BulkSend,
    oneshot::Receiver<Result<(), ChatError>>,
) {
    let (completed, result) = oneshot::channel();
    let memory = super::super::bulk::reserve_bytes(frames.iter().map(Vec::len).sum()).unwrap();
    (
        super::super::bulk::BulkSend {
            client_id: "view".into(),
            generation: runtime.generation,
            session_id: "phone".into(),
            frames,
            completed,
            _memory: memory,
        },
        result,
    )
}

#[test]
fn bulk_batches_reject_stale_generations_other_sessions_and_revoked_capabilities() {
    let mut runtime = tests::connected_identity();
    for case in 0..4 {
        runtime.binary_bulk = case != 2;
        let (mut command, mut result) = request(&runtime, vec![wire_frame()]);
        match case {
            0 => command.generation += 1,
            1 => command.session_id = "unpaired".into(),
            3 => command.client_id = "old-view".into(),
            _ => {}
        }
        runtime.send_bulk(command);
        assert!(matches!(
            result.try_recv().unwrap(),
            Err(ChatError::InvalidFrame)
        ));
    }
}

fn transfer(records_per_command: usize, records: usize) -> Duration {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let frame = wire_frame();
    let expected = frame.clone();
    let reader = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let mut socket = WebSocket::from_raw_socket(stream, Role::Server, None);
        let mut received = 0;
        while received < records {
            match socket.read().unwrap() {
                Message::Binary(bytes) => {
                    assert_eq!(bytes.as_ref(), expected.as_slice());
                    received += 1;
                }
                Message::Ping(bytes) => socket.send(Message::Pong(bytes)).unwrap(),
                frame => panic!("unexpected frame: {frame:?}"),
            }
        }
        // Keep the socket alive during the last timed read, just like an idle live relay.
        thread::sleep(POLL_INTERVAL * 2);
    });
    let stream = TcpStream::connect(address).unwrap();
    stream.set_nodelay(true).unwrap();
    stream.set_read_timeout(Some(POLL_INTERVAL)).unwrap();
    let mut runtime = tests::connected_identity();
    runtime.socket = Some(WebSocket::from_raw_socket(
        MaybeTlsStream::Plain(stream),
        Role::Client,
        None,
    ));
    runtime.binary_bulk = true;
    runtime.registered = true;
    let start = Instant::now();
    for _ in 0..records / records_per_command {
        let (command, mut result) = request(&runtime, vec![frame.clone(); records_per_command]);
        runtime.send_bulk(command);
        assert!(result.try_recv().unwrap().is_ok());
        runtime.tick();
    }
    let elapsed = start.elapsed();
    reader.join().unwrap();
    elapsed
}

#[test]
#[ignore = "manual 64 MiB localhost socket benchmark with real 20 ms idle reads"]
fn sustained_bulk_socket_throughput() {
    let records = 32 * 1024 * 1024 / (16 * 1024);
    let single = transfer(1, records);
    let batched = transfer(16, records);
    eprintln!(
        "32 MiB socket: single {:.2} MiB/s ({single:?}); batched {:.2} MiB/s ({batched:?})",
        32.0 / single.as_secs_f64(),
        32.0 / batched.as_secs_f64()
    );
    assert!(batched * 3 < single, "batching should amortize idle reads");
}
