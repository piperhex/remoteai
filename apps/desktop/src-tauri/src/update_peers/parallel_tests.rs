use super::*;
use crate::update_peers::{signaling::Lease, tests::network_fixture};

#[tokio::test(flavor = "multi_thread", worker_threads = 6)]
async fn three_native_seeders_deliver_disjoint_ranges_without_origin_download() {
    let bytes: Vec<u8> = (0..300_127).map(|index| (index % 251) as u8).collect();
    let origin = Origin::with_bytes(bytes.clone());
    let update = origin.update().await;
    let directory = tempfile::tempdir().unwrap();
    let seed_service = service(directory.path(), &origin.key);
    let artifact = Artifact::from_update(&update);
    seed_service
        .cache
        .save(artifact.clone(), Arc::new(bytes.clone()))
        .await
        .unwrap();
    let receiving_directory = tempfile::tempdir().unwrap();
    let receiving = service(receiving_directory.path(), &origin.key);
    let coordinator = network_fixture::coordinator("multi-source-coordinator").await;
    let (sender, mut broker) = mpsc::channel(16);
    receiving.broker.send_replace(Some(sender.clone()));
    let mut leases = Vec::new();
    let mut seeds = Vec::new();
    let mut workers = Vec::new();
    for index in 0..3 {
        let mut config = network_fixture::client(&coordinator, &format!("multi-source-{index}"));
        config.desktop = true;
        let seed = csw_chat_connectivity::Connection::start(config.clone()).unwrap();
        seeds.push(seed.clone());
        let (cache, id) = (seed_service.cache.clone(), artifact.id.clone());
        workers.push(tokio::spawn(async move {
            transfer::seed(&seed, &cache, &id).await
        }));
        config.desktop = false;
        leases.push(Lease::new(config, sender.clone()).unwrap());
    }
    let signaling = tokio::spawn(async move {
        let Some(Request::Find { reply, .. }) = broker.recv().await else {
            panic!("expected peer lookup")
        };
        assert!(reply.send(Ok(leases)).is_ok());
        while broker.recv().await.is_some() {}
    });
    let result = tokio::time::timeout(
        Duration::from_secs(45),
        resolve(&receiving, &update, &mut progress()),
    )
    .await;
    for seed in seeds {
        seed.close();
    }
    for worker in workers {
        worker.abort();
    }
    signaling.abort();
    coordinator.stop().await;
    assert_eq!(result.unwrap().unwrap().bytes.as_slice(), bytes);
    assert_eq!(
        origin.downloads.load(Ordering::Relaxed),
        0,
        "multi-source unexpectedly used GitHub"
    );
}
