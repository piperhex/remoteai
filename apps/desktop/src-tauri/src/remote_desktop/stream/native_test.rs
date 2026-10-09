use super::{model::*, native::Stream};
use std::{
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires an unlocked Windows desktop, prepared video runtime and Edge"]
async fn native_capture_reaches_a_real_browser_decoder() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources/remote-desktop/runtime/ffmpeg.exe");
    let requested = std::env::var("CSW_NATIVE_TEST_DISPLAY").ok();
    let opened = super::super::open(requested.clone(), Default::default(), None)
        .expect("native input lease");
    if let Some(requested) = requested {
        assert_eq!(opened.display_id, requested);
    }
    let display = opened
        .displays
        .iter()
        .find(|display| display.id == opened.display_id)
        .unwrap();
    let aspect = f64::from(display.width) / f64::from(display.height);
    println!(
        "native display: {} {}x{}",
        display.name, display.width, display.height
    );
    let id = opened.id;
    let request = OpenRequest {
        relay_standby: std::env::var_os("CSW_NATIVE_TEST_STANDBY").is_some(),
        clipboard_channel: false,
        id: id.clone(),
        profile: Profile {
            codec: if std::env::var("CSW_NATIVE_TEST_CODEC").as_deref() == Ok("h265") {
                super::codec::VideoCodec::H265
            } else {
                super::codec::VideoCodec::H264
            },
            adaptive_fps: false,
            adaptive_resolution: false,
            width: 1920,
            fps: std::env::var("CSW_NATIVE_TEST_FPS")
                .map(|value| value.parse().expect("test frame rate"))
                .unwrap_or(60),
            bitrate: 6_000_000,
        },
        ice_servers: std::env::var("CSW_NATIVE_TEST_ICE")
            .map(|json| serde_json::from_str(&json).expect("test ICE servers"))
            .unwrap_or_default(),
    };
    let (stream, offer) = Stream::open(path, request)
        .await
        .expect("native capture and encoder");
    if std::env::var("CSW_NATIVE_TEST_CODEC").as_deref() == Ok("h265") {
        assert_eq!(
            stream.profile.borrow().codec,
            super::codec::VideoCodec::H265,
            "HEVC encoder selected"
        );
    }
    let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").expect("local test bridge"));
    let endpoint = format!("http://{}", server.server_addr());
    let token = uuid::Uuid::new_v4().to_string();
    let stopped = Arc::new(AtomicBool::new(false));
    let worker = start_bridge(
        server,
        stream.clone(),
        offer,
        (token.clone(), stopped.clone()),
    );
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let upgrading = std::env::var_os("CSW_NATIVE_TEST_UPGRADE").is_some();
    let script = if upgrading {
        "native-desktop-upgrade.mjs"
    } else {
        "native-desktop-stream.mjs"
    };
    let result = tokio::process::Command::new("node")
        .arg(root.join("apps/desktop/e2e").join(script))
        .env("CSW_NATIVE_TEST_ENDPOINT", endpoint)
        .env("CSW_NATIVE_TEST_TOKEN", token)
        .env("CSW_NATIVE_TEST_ASPECT", aspect.to_string())
        .output()
        .await;
    let connection = stream.stats.lock().await.connection;
    stopped.store(true, Ordering::Relaxed);
    stream.close().await;
    worker.join().expect("test bridge stopped");
    let output = result.expect("browser process");
    println!("{}", String::from_utf8_lossy(&output.stdout));
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    if upgrading {
        assert!(
            matches!(connection, Some(Connection::Direct)),
            "native upgraded to direct pair"
        );
    } else if std::env::var_os("CSW_NATIVE_TEST_ICE").is_some() {
        assert!(
            matches!(connection, Some(Connection::Relay)),
            "native selected relay pair"
        );
    }
}

fn start_bridge(
    server: Arc<tiny_http::Server>,
    stream: Arc<Stream>,
    offer: Offer,
    control: (String, Arc<AtomicBool>),
) -> std::thread::JoinHandle<()> {
    let runtime = tokio::runtime::Handle::current();
    std::thread::spawn(move || {
        while !control.1.load(Ordering::Relaxed) {
            let Ok(Some(mut request)) = server.recv_timeout(Duration::from_millis(100)) else {
                continue;
            };
            let authorized = request.headers().iter().any(|header| {
                header.field.equiv("X-Desktop-Test") && header.value.as_str() == control.0
            });
            if !authorized {
                request
                    .respond(tiny_http::Response::empty(403))
                    .expect("reject test caller");
                continue;
            }
            let mut body = String::new();
            request
                .as_reader()
                .take(128_000)
                .read_to_string(&mut body)
                .expect("test request");
            let result = if request.url() == "/offer" {
                serde_json::to_value(&offer).expect("offer JSON")
            } else if request.url() == "/stats" {
                let stats = runtime.block_on(async { stream.stats.lock().await.clone() });
                serde_json::to_value(stats).expect("stats JSON")
            } else {
                let mut value: serde_json::Value =
                    serde_json::from_str(&body).expect("signal JSON");
                value["id"] = stream.id.clone().into();
                let signal = serde_json::from_value(value).expect("signal request");
                serde_json::to_value(
                    runtime
                        .block_on(stream.signal(signal))
                        .expect("signal accepted"),
                )
                .expect("reply")
            };
            request
                .respond(tiny_http::Response::from_string(result.to_string()))
                .expect("test reply");
        }
    })
}
