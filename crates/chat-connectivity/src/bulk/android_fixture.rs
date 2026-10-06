//! Explicit local fixture for the Android JNI regression, reached only through adb reverse.
use super::*;
use crate::tests::{engine, local_core};
use easytier::common::config::ConfigLoader;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "run with NativeBulkDeviceTest and adb reverse tcp:18779 tcp:18779"]
async fn android_binary_bridge_fixture() {
    let core = local_core(true, "native-bulk-android");
    core.set_listeners(vec!["tcp://127.0.0.1:18779".parse().unwrap()]);
    let host = engine(core);
    host.start().await.unwrap();
    let source = Bulk::new();
    let (route, status) = watch::channel(RouteStatus::default());
    let (events, mut output) = mpsc::channel(8);
    let mut workers = tokio::task::JoinSet::new();
    let engine = host.clone();
    workers.spawn(async move {
        loop {
            route.send_replace(crate::route::status(&engine, "csw-client").await);
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    });
    let engine = host.clone();
    let files = source.clone();
    workers.spawn(async move {
        files.run(&engine, true, (&status, &events)).await.unwrap();
    });
    println!("Android binary fixture ready on loopback tcp:18779");
    let result = tokio::time::timeout(Duration::from_secs(120), async {
        assert!(matches!(
            output.recv().await,
            Some(Event::Bulk { generation: 1 })
        ));
        for group in 0..16 {
            let records: Vec<_> = (1..=16).map(|n| fixture_record(group * 16 + n)).collect();
            source.send(1, super::tests::batch(&records)).await.unwrap();
        }
        println!("Android binary fixture sent 256 records (4 MiB)");
        assert!(matches!(
            output.recv().await,
            Some(Event::Bulk { generation: 0 })
        ));
    })
    .await;
    workers.abort_all();
    while workers.join_next().await.is_some() {}
    host.stop().await;
    assert!(result.is_ok(), "Android binary bridge fixture timed out");
}

// Synthetic ciphertext tests byte-exact native delivery. BulkDownloadTest covers AEAD and file hashes.
fn fixture_record(sequence: u32) -> Vec<u8> {
    let mut record = vec![(sequence % 251) as u8; wire::MAX_RECORD];
    record[..72].fill(0);
    record[..8].copy_from_slice(b"RAB1\x01\x01\x00\x48");
    record[23] = 1; // transfer UUID
    record[39] = 2; // epoch UUID
    record[55] = 3; // request UUID
    record[64..68].copy_from_slice(&((wire::MAX_RECORD - 88) as u32).to_be_bytes());
    record[68..72].copy_from_slice(&sequence.to_be_bytes());
    record
}
