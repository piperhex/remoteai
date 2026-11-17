use super::{model::*, peer::Peer};
use std::time::Duration;

async fn local_peer() -> std::sync::Arc<Peer> {
    let mut settings = webrtc::api::setting_engine::SettingEngine::default();
    settings.set_include_loopback_candidate(true);
    settings.set_ip_filter(Box::new(|ip| ip.is_loopback()));
    settings.set_network_types(vec![webrtc::ice::network_type::NetworkType::Udp4]);
    Peer::configured(configuration(), settings).await.unwrap()
}

fn configuration() -> Configuration {
    Configuration {
        ice_servers: Vec::new(),
        relay_only: false,
        receive_media: false,
    }
}

#[test]
fn rejects_unknown_labels_and_unbounded_servers() {
    let channel = ChannelSpec {
        key: uuid::Uuid::new_v4().to_string(),
        label: "arbitrary".into(),
        negotiated: None,
    };
    assert!(channel.validate().is_err());
    let mut config = configuration();
    config.ice_servers.push(IceServer {
        urls: vec!["file:///secret".into()],
        username: String::new(),
        credential: String::new(),
    });
    assert!(config.validate().is_err());
}

async fn connect(left: &Peer, right: &Peer) {
    let mut gathered = left.rtc.gathering_complete_promise().await;
    left.rtc
        .set_local_description(left.rtc.create_offer(None).await.unwrap())
        .await
        .unwrap();
    gathered.recv().await;
    right
        .rtc
        .set_remote_description(left.rtc.local_description().await.unwrap())
        .await
        .unwrap();
    let mut gathered = right.rtc.gathering_complete_promise().await;
    right
        .rtc
        .set_local_description(right.rtc.create_answer(None).await.unwrap())
        .await
        .unwrap();
    gathered.recv().await;
    left.rtc
        .set_remote_description(right.rtc.local_description().await.unwrap())
        .await
        .unwrap();
}

async fn wait_open(peer: &Peer) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if peer
                .poll()
                .await
                .unwrap()
                .iter()
                .any(|event| matches!(event, Event::Open { .. }))
            {
                return;
            }
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn chat_window_delivers_ordered_bursts_and_remains_writable_after_draining() {
    let left = local_peer().await;
    let right = local_peer().await;
    let spec = ChannelSpec {
        key: uuid::Uuid::new_v4().to_string(),
        label: "codex-chat-v1".into(),
        negotiated: None,
    };
    left.create_channel(spec.clone()).await.unwrap();
    connect(&left, &right).await;
    wait_open(&left).await;
    let channel = left.channel(&spec.key).await.unwrap();
    let payload = "0123456789abcdef".repeat(2048);
    let send = async {
        for sequence in 0..96 {
            channel
                .send(format!("{sequence}:{payload}").into(), true)
                .await
                .unwrap();
        }
        channel
            .send(bytes::Bytes::from_static(b"after-burst"), true)
            .await
            .unwrap();
    };
    tokio::time::timeout(Duration::from_secs(15), async {
        tokio::join!(send, receive_chat_burst(&right, &payload));
    })
    .await
    .unwrap();
    left.close().await;
    assert!(channel
        .send(bytes::Bytes::from_static(b"closed"), true)
        .await
        .is_err());
    right.close().await;
}

async fn receive_chat_burst(peer: &Peer, payload: &str) {
    let mut sequence = 0;
    loop {
        for event in peer.poll().await.unwrap() {
            let Event::Text { text, .. } = event else {
                continue;
            };
            if sequence == 96 {
                assert_eq!(text, "after-burst");
                return;
            }
            assert_eq!(text, format!("{sequence}:{payload}"));
            sequence += 1;
        }
    }
}

#[tokio::test]
async fn negotiated_file_channel_delivers_binary_and_rejects_sends_after_close() {
    let left = local_peer().await;
    let right = local_peer().await;
    let spec = ChannelSpec {
        key: uuid::Uuid::new_v4().to_string(),
        label: "remote-ai-file-v1".into(),
        negotiated: Some(42),
    };
    left.create_channel(spec.clone()).await.unwrap();
    right.create_channel(spec.clone()).await.unwrap();
    connect(&left, &right).await;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if left
                .poll()
                .await
                .unwrap()
                .iter()
                .any(|event| matches!(event, Event::Open { .. }))
            {
                break;
            }
        }
    })
    .await
    .unwrap();
    left.channel(&spec.key)
        .await
        .unwrap()
        .send(bytes::Bytes::from_static(b"binary-payload"), false)
        .await
        .unwrap();
    let received = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let bytes = right.receive_binary().await.unwrap();
            if !bytes.is_empty() {
                break bytes;
            }
            right.poll().await.unwrap();
        }
    })
    .await
    .unwrap();
    let length = u32::from_be_bytes(received[..4].try_into().unwrap()) as usize;
    assert_eq!(&received[8 + length..], b"binary-payload");
    left.close().await;
    right.close().await;
    assert!(left.channel(&spec.key).await.is_err());
}
