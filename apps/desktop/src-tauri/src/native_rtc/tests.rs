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
