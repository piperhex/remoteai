//! Manual synthetic transport comparison with the same Android instrumentation used for WebView2.
use super::{model::*, peer::Peer};
use bytes::Bytes;
use serde_json::{json, Value};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

const CONTROL: &str = "http://127.0.0.1:18786";

pub(super) async fn event(peer: &Peer, open: bool) -> Value {
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            for event in peer.poll().await.unwrap() {
                match event {
                    Event::Open { .. } if open => return Value::Null,
                    Event::Text { text, .. } if !open => {
                        return serde_json::from_str(&text).unwrap()
                    }
                    Event::Closed => panic!("native benchmark peer closed"),
                    _ => {}
                }
            }
        }
    })
    .await
    .unwrap()
}

async fn negotiate(peer: &Peer, http: &reqwest::Client) {
    let mut gathered = peer.rtc.gathering_complete_promise().await;
    peer.rtc
        .set_local_description(peer.rtc.create_offer(None).await.unwrap())
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(15), gathered.recv())
        .await
        .unwrap();
    http.post(format!("{CONTROL}/offer"))
        .json(&peer.rtc.local_description().await.unwrap())
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let answer: RTCSessionDescription = http
        .get(format!("{CONTROL}/answer"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    peer.rtc.set_remote_description(answer).await.unwrap();
    event(peer, true).await;
}

async fn sample(peer: &Peer, channel: &super::channel::Channel, config: &Value, run: u32) -> Value {
    let count = config["records"].as_u64().unwrap() as u32;
    let mut bytes = vec![37; config["recordBytes"].as_u64().unwrap() as usize];
    bytes[..4].copy_from_slice(b"RBT1");
    bytes[4..8].copy_from_slice(&run.to_be_bytes());
    bytes[12..16].copy_from_slice(&count.to_be_bytes());
    let started = Instant::now();
    for sequence in 0..count {
        bytes[8..12].copy_from_slice(&sequence.to_be_bytes());
        channel
            .send(Bytes::copy_from_slice(&bytes), false)
            .await
            .unwrap();
    }
    let receiver = event(peer, false).await;
    assert_eq!(receiver["run"], run);
    json!({"run":run,"ms":started.elapsed().as_secs_f64()*1000.0,"receiver":receiver})
}

#[test]
#[ignore = "Manual release transport benchmark; requires the Android control runner on loopback 18786"]
fn android_sender_throughput() {
    let workers = std::env::var("P2P_BENCH_WORKERS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(4);
    assert!((1..=16).contains(&workers));
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .build()
        .unwrap()
        .block_on(run());
}

async fn run() {
    // Keep this a runtime guard: ignored benchmarks must also compile in the debug test target.
    assert!(
        !std::hint::black_box(cfg!(debug_assertions)),
        "Use --release"
    );
    let http = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(180))
        .build()
        .unwrap();
    let config: Value = http
        .get(format!("{CONTROL}/config"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let (settings, mux) = settings(&config).await;
    let peer: Arc<Peer> = Peer::configured(
        Configuration {
            ice_servers: Vec::new(),
            relay_only: false,
            receive_media: false,
        },
        settings,
    )
    .await
    .unwrap();
    let spec = ChannelSpec {
        key: uuid::Uuid::new_v4().to_string(),
        label: if config["encrypted"] == true {
            "remote-ai-file-v1"
        } else {
            "codex-chat-v1"
        }
        .into(),
        negotiated: if config["encrypted"] == true {
            Some(42)
        } else {
            None
        },
    };
    peer.create_channel(spec.clone()).await.unwrap();
    negotiate(&peer, &http).await;
    let channel = peer.channel(&spec.key).await.unwrap();
    channel
        .test_watermarks(
            config["highWaterBytes"].as_u64().unwrap() as usize,
            config["lowWaterBytes"].as_u64().unwrap() as usize,
        )
        .await;
    let mut samples = Vec::new();
    if config["encrypted"] == true {
        samples = super::encrypted_benchmark::samples(&peer, &channel, &config).await;
    } else {
        for run in 0..config["runs"].as_u64().unwrap() as u32 {
            samples.push(sample(&peer, &channel, &config, run).await);
        }
    }
    let stats = peer.rtc.get_stats().await;
    channel
        .send(Bytes::from_static(b"finish"), true)
        .await
        .unwrap();
    http.get(format!("{CONTROL}/report"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    peer.close().await;
    if let Some(mux) = mux {
        mux.close().await.unwrap();
    }
    println!(
        "NATIVE_RTC_BENCHMARK {}",
        json!({"samples":samples,"stats":stats})
    );
}

async fn settings(
    config: &Value,
) -> (
    webrtc::api::setting_engine::SettingEngine,
    Option<Arc<dyn webrtc::ice::udp_mux::UDPMux + Send + Sync>>,
) {
    use webrtc::ice::{
        udp_mux::{UDPMuxDefault, UDPMuxParams},
        udp_network::UDPNetwork,
    };
    let mut settings = webrtc::api::setting_engine::SettingEngine::default();
    if config["socketMode"] != "mux" {
        return (settings, None);
    }
    // Diagnostic LAN-only mode: the upstream mux skips srflx gathering, so this is never a product default.
    let socket = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::DGRAM,
        Some(socket2::Protocol::UDP),
    )
    .unwrap();
    let buffer = config["udpBufferKiB"].as_u64().unwrap_or(0) as usize * 1024;
    if buffer > 0 {
        socket.set_recv_buffer_size(buffer).unwrap();
        socket.set_send_buffer_size(buffer).unwrap();
    }
    socket.set_nonblocking(true).unwrap();
    socket
        .bind(&"0.0.0.0:0".parse::<std::net::SocketAddr>().unwrap().into())
        .unwrap();
    let socket = tokio::net::UdpSocket::from_std(socket.into()).unwrap();
    let mux = UDPMuxDefault::new(UDPMuxParams::new(socket));
    settings.set_udp_network(UDPNetwork::Muxed(mux.clone()));
    (settings, Some(mux))
}
