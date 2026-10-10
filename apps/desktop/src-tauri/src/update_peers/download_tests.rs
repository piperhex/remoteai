use super::*;
use crate::update_peers::{cache::Cache, signaling::Request, tests::signed};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::{mpsc, watch, Semaphore};

#[path = "parallel_tests.rs"]
mod parallel_tests;
#[path = "peer_download_tests.rs"]
mod peer_tests;

struct Origin {
    url: url::Url,
    key: String,
    downloads: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl Origin {
    fn start() -> Self {
        Self::with_bytes(b"signed installer".to_vec())
    }

    fn with_bytes(bytes: Vec<u8>) -> Self {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let url: url::Url = format!("http://{}/latest.json", server.server_addr())
            .parse()
            .unwrap();
        let (key, signature) = signed(&bytes);
        let manifest = serde_json::json!({"version":"99.0.0", "signature":signature,
            "url":url.join("installer.exe").unwrap(), "notes":"test"})
        .to_string();
        let downloads = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let (count, stopped) = (downloads.clone(), stop.clone());
        let worker = std::thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                let Some(request) = server.recv_timeout(Duration::from_millis(50)).unwrap() else {
                    continue;
                };
                let body = if request.url() == "/latest.json" {
                    manifest.as_bytes()
                } else {
                    count.fetch_add(1, Ordering::Relaxed);
                    bytes.as_slice()
                };
                request
                    .respond(tiny_http::Response::from_data(body))
                    .unwrap();
            }
        });
        Self {
            url,
            key,
            downloads,
            stop,
            worker: Some(worker),
        }
    }

    async fn update(&self) -> Update {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            serde_json::json!({
                "pubkey":self.key, "dangerousInsecureTransportProtocol":true,
            }),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        app.updater_builder()
            .endpoints(vec![self.url.clone()])
            .unwrap()
            .no_proxy()
            .build()
            .unwrap()
            .check()
            .await
            .unwrap()
            .unwrap()
    }
}

impl Drop for Origin {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.worker.take().unwrap().join().unwrap();
    }
}

fn service(path: &std::path::Path, key: &str) -> Arc<Service> {
    Arc::new(Service {
        cache: Arc::new(Cache::new(path.into(), key.into())),
        broker: watch::channel(None).0,
        uploads: Arc::new(Semaphore::new(2)),
        downloads: Semaphore::new(1),
    })
}

fn progress() -> Progress {
    Progress {
        channel: Channel::new(|_| Ok(())),
        started: false,
    }
}

#[tokio::test]
async fn missing_peer_falls_back_to_origin_and_restart_reuses_verified_cache() {
    let origin = Origin::start();
    let update = origin.update().await;
    let directory = tempfile::tempdir().unwrap();
    let service = service(directory.path(), &origin.key);
    let package = resolve(&service, &update, &mut progress()).await.unwrap();
    assert_eq!(package.bytes.as_slice(), b"signed installer");
    assert_eq!(origin.downloads.load(Ordering::Relaxed), 1);
    service.cache.restore().await.unwrap();
    resolve(&service, &update, &mut progress()).await.unwrap();
    assert_eq!(origin.downloads.load(Ordering::Relaxed), 1);
    std::fs::write(
        directory.path().join(format!("{}.pkg", package.artifact)),
        b"broken installer",
    )
    .unwrap();
    resolve(&service, &update, &mut progress()).await.unwrap();
    assert_eq!(origin.downloads.load(Ordering::Relaxed), 2);
}

#[tokio::test]
async fn failed_peer_lookup_still_downloads_from_origin() {
    let origin = Origin::start();
    let update = origin.update().await;
    let directory = tempfile::tempdir().unwrap();
    let service = service(directory.path(), &origin.key);
    let (sender, mut receiver) = mpsc::channel(1);
    service.broker.send_replace(Some(sender));
    let lookup = tokio::spawn(async move {
        let Some(Request::Find { reply, .. }) = receiver.recv().await else {
            panic!("expected peer lookup")
        };
        assert!(reply.send(Err(Error::Unavailable)).is_ok());
    });
    resolve(&service, &update, &mut progress()).await.unwrap();
    lookup.await.unwrap();
    assert_eq!(origin.downloads.load(Ordering::Relaxed), 1);
}
