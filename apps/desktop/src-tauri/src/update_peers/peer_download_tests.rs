use super::*;
use crate::update_peers::{signaling::Lease, tests::network_fixture};
use base64::{engine::general_purpose::STANDARD, Engine};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_seed_serves_verified_cache_over_a_discovered_direct_connection() {
    let bytes: Vec<u8> = (0..200_123).map(|index| (index % 251) as u8).collect();
    let origin = Origin::with_bytes(bytes.clone());
    let update = origin.update().await;
    let directory = tempfile::tempdir().unwrap();
    let service = service(directory.path(), &origin.key);
    let artifact = Artifact::from_update(&update);
    service
        .cache
        .save(artifact.clone(), Arc::new(bytes.clone()))
        .await
        .unwrap();
    let coordinator = network_fixture::coordinator("update-coordinator-test").await;
    let mut config = network_fixture::client(&coordinator, "update-seed-test");
    config.desktop = true;
    let seed = csw_chat_connectivity::Connection::start(config.clone()).unwrap();
    config.desktop = false;
    let receiver = csw_chat_connectivity::Connection::start(config).unwrap();
    let result = tokio::time::timeout(Duration::from_secs(25), async {
        tokio::join!(
            transfer::seed(&seed, &service.cache, &artifact.id),
            transfer::download(&receiver, &artifact.id, |_, _| {}),
        )
    })
    .await;
    receiver.close();
    seed.close();
    coordinator.stop().await;
    let (sent, received) = result.unwrap();
    assert!(sent.is_ok(), "seed: {sent:?}; receiver: {received:?}");
    assert_eq!(received.unwrap(), bytes);
    assert_eq!(origin.downloads.load(Ordering::Relaxed), 0);
}

async fn write_frame(stream: &mut (impl AsyncWriteExt + Unpin), value: serde_json::Value) {
    let frame = value.to_string();
    stream.write_u32(frame.len() as u32).await.unwrap();
    stream.write_all(frame.as_bytes()).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn native_peer_download_verifies_bytes_and_falls_back_after_tampering_or_disconnect() {
    for behavior in ["valid", "tampered", "disconnected", "oversized"] {
        exercise_peer(behavior).await;
    }
}

async fn exercise_peer(behavior: &'static str) {
    let origin = Origin::start();
    let update = origin.update().await;
    let directory = tempfile::tempdir().unwrap();
    let service = service(directory.path(), &origin.key);
    let host = network_fixture::host(behavior).await;
    let mut listener = host
        .data_plane_tcp_bind(47777, Duration::from_secs(3))
        .await
        .unwrap();
    let (sender, mut receiver) = mpsc::channel(4);
    service.broker.send_replace(Some(sender.clone()));
    let config = network_fixture::client(&host, behavior);
    let signaling = tokio::spawn(async move {
        let Some(Request::Find { reply, .. }) = receiver.recv().await else {
            panic!("expected lookup")
        };
        assert!(reply
            .send(Lease::new(config, sender).map(|lease| vec![lease]))
            .is_ok());
        receiver.recv().await;
    });
    let seed = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let size = stream.read_u32().await.unwrap() as usize;
        let mut request = vec![0; size];
        stream.read_exact(&mut request).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&request).unwrap()["type"],
            "get"
        );
        respond(&mut stream, behavior).await;
    });
    let result = tokio::time::timeout(
        Duration::from_secs(25),
        resolve(&service, &update, &mut progress()),
    )
    .await;
    host.stop().await;
    signaling.abort();
    seed.abort();
    assert_eq!(
        result.unwrap().unwrap().bytes.as_slice(),
        b"signed installer",
        "{behavior}"
    );
    assert_eq!(
        origin.downloads.load(Ordering::Relaxed),
        usize::from(behavior != "valid"),
        "{behavior}"
    );
}

async fn respond(stream: &mut (impl AsyncReadExt + AsyncWriteExt + Unpin), behavior: &str) {
    let size = if behavior == "oversized" {
        super::super::super::MAX_PACKAGE_BYTES + 1
    } else {
        16
    };
    write_frame(stream, serde_json::json!({"type":"header", "size":size})).await;
    if behavior == "disconnected" || behavior == "oversized" {
        return;
    }
    let bytes = if behavior == "tampered" {
        b"broken installer"
    } else {
        b"signed installer"
    };
    write_frame(
        stream,
        serde_json::json!({"type":"chunk", "offset":0, "data":STANDARD.encode(bytes)}),
    )
    .await;
    write_frame(stream, serde_json::json!({"type":"complete"})).await;
    // Keep the direct path alive until the receiver has consumed and verified the package.
    let _receipt = tokio::time::timeout(Duration::from_secs(5), stream.read_u32()).await;
}
