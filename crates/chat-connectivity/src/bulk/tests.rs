use super::*;
use crate::tests::{endpoint, engine, local_core};

fn record(value: u8) -> Vec<u8> {
    let mut bytes = vec![value; wire::MAX_RECORD];
    bytes[..8].copy_from_slice(b"RAB1\x01\x01\x00\x48");
    bytes[64..68].copy_from_slice(&((wire::MAX_RECORD - 88) as u32).to_be_bytes());
    bytes
}

pub(super) fn batch(records: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = b"RAN1".to_vec();
    bytes.push(records.len() as u8);
    for record in records {
        bytes.extend_from_slice(&(record.len() as u32).to_be_bytes());
        bytes.extend_from_slice(record);
    }
    bytes
}

#[test]
fn rejects_unbounded_or_malformed_batches_before_writing_any_record() {
    let packet = record(3);
    assert!(wire::validate_batch(&batch(&vec![packet.clone(); 16])).is_ok());
    assert!(wire::validate_batch(&batch(&vec![packet.clone(); 17])).is_err());
    assert!(wire::validate_batch(&batch(&[])).is_err());
    let mut malformed = packet.clone();
    malformed[64..68].copy_from_slice(&u32::MAX.to_be_bytes());
    assert!(wire::validate_batch(&batch(&[packet.clone(), malformed])).is_err());
    let mut trailing = batch(std::slice::from_ref(&packet));
    trailing.push(0);
    assert!(wire::validate_batch(&trailing).is_err());
    for length in 0..trailing.len() {
        assert!(wire::validate_batch(&trailing[..length]).is_err() || length == trailing.len() - 1);
    }
}

#[tokio::test]
async fn partial_record_survives_slow_read_and_oversized_length_is_rejected() {
    let (mut source, mut sink) = tokio::io::duplex(64);
    let packet = record(8);
    let expected = packet.clone();
    let writer = tokio::spawn(async move {
        source.write_u32(packet.len() as u32).await.unwrap();
        source.write_all(&packet[..9]).await.unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        source.write_all(&packet[9..]).await.unwrap();
        source.write_u32(u32::MAX).await.unwrap();
    });
    assert_eq!(wire::read_record(&mut sink).await.unwrap(), expected);
    assert!(matches!(
        wire::read_record(&mut sink).await,
        Err(Error::Invalid)
    ));
    writer.await.unwrap();
}

async fn generation(events: &mut mpsc::Receiver<Event>) -> u64 {
    loop {
        if let Event::Bulk { generation } = events.recv().await.unwrap() {
            return generation;
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_bulk_uses_a_separate_stream_and_fences_reconnected_generations() {
    let host = engine(local_core(true, "native-bulk"));
    let client = engine(local_core(false, "native-bulk"));
    host.start().await.unwrap();
    client.start().await.unwrap();
    client.add_connector(endpoint(&host)).unwrap();
    let result =
        tokio::time::timeout(Duration::from_secs(35), mesh_round_trip(&host, &client)).await;
    client.stop().await;
    host.stop().await;
    assert!(result.is_ok(), "native file stream timed out");
}

async fn mesh_round_trip(host: &Arc<NativeCoreInstance>, client: &Arc<NativeCoreInstance>) {
    while !crate::route::status(client, "csw-host").await.direct {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let direct = RouteStatus {
        direct: true,
        ..RouteStatus::default()
    };
    let (route, status) = watch::channel(direct.clone());
    let source = Bulk::new();
    let receiver = Bulk::new();
    let (events, mut output) = mpsc::channel(8);
    let source_task = spawn_bulk(
        (source.clone(), host.clone()),
        true,
        (status.clone(), events.clone()),
    );
    let receiver_task = spawn_bulk((receiver.clone(), client.clone()), false, (status, events));
    let mut tasks = tokio::task::JoinSet::new();
    tasks.spawn(source_task);
    tasks.spawn(receiver_task);
    assert_eq!(generation(&mut output).await, 1);
    assert_eq!(generation(&mut output).await, 1);
    transfer_with_chat(&source, &receiver, (host, client)).await;
    route.send_replace(RouteStatus::default());
    assert_eq!(generation(&mut output).await, 0);
    assert_eq!(generation(&mut output).await, 0);
    assert!(source.send(1, batch(&[record(1)])).await.is_err());
    route.send_replace(direct);
    assert_eq!(generation(&mut output).await, 2);
    assert_eq!(generation(&mut output).await, 2);
    assert!(source.send(1, batch(&[record(2)])).await.is_err());
    source.send(2, batch(&[record(9)])).await.unwrap();
    assert_eq!(receiver.receive().await.unwrap(), record(9));
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
}

async fn spawn_bulk(
    input: (Arc<Bulk>, Arc<NativeCoreInstance>),
    desktop: bool,
    output: (watch::Receiver<RouteStatus>, mpsc::Sender<Event>),
) {
    input
        .0
        .run(&input.1, desktop, (&output.0, &output.1))
        .await
        .unwrap();
}

async fn transfer_with_chat(
    source: &Bulk,
    receiver: &Bulk,
    peers: (&Arc<NativeCoreInstance>, &Arc<NativeCoreInstance>),
) {
    let (host, client) = peers;
    let mut listener = host
        .data_plane_tcp_bind(crate::config::CHAT_PORT, CONNECT_TIMEOUT)
        .await
        .unwrap();
    let mut chat = client
        .data_plane_tcp_connect(
            ([10, 253, 0, 1], crate::config::CHAT_PORT).into(),
            CONNECT_TIMEOUT,
        )
        .await
        .unwrap();
    let (mut remote, _) = listener.accept().await.unwrap();
    let send = async {
        for value in 0..16 {
            source
                .send(1, batch(&vec![record(value); 16]))
                .await
                .unwrap();
        }
    };
    let receive = async {
        // Stop consuming file records while exercising the independent control stream.
        tokio::time::sleep(Duration::from_millis(150)).await;
        chat.write_all(b"pause-resume").await.unwrap();
        let mut message = [0; 12];
        tokio::time::timeout(Duration::from_secs(2), remote.read_exact(&mut message))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&message, b"pause-resume");
        for value in 0..16 {
            for _ in 0..16 {
                assert_eq!(receiver.receive().await.unwrap(), record(value));
            }
        }
    };
    tokio::join!(send, receive);
}
