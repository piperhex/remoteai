use super::*;

#[path = "standby_race_tests.rs"]
mod standby_race_tests;
use crate::remote_desktop::{
    displays::{Bounds, DisplayInfo},
    monitors::Monitor,
};
use tokio::sync::{mpsc, watch, Mutex};
use webrtc::{
    data_channel::RTCDataChannel, peer_connection::sdp::session_description::RTCSessionDescription,
};

#[test]
fn reservations_bound_concurrent_creation_and_ignore_replayed_generations() {
    let mut state = Upgrades::default();
    reserve(&mut state, 1).unwrap();
    state.started = Some(Instant::now() - Duration::from_secs(10));
    assert!(reserve(&mut state, 2).is_err());
    state.creating = false;
    assert!(reserve(&mut state, 1).is_err());
    reserve(&mut state, 2).unwrap();
    assert_eq!(state.generation, 2);
}

#[test]
fn native_media_markers_require_local_credentials_and_stay_available_in_direct_probes() {
    let adapter = IceServer {
        urls: vec!["turn:127.0.0.1:12345?transport=udp".into()],
        username: "desktop-media".into(),
        credential: "ab".repeat(32),
        native_media: true,
        local_address: "10.253.0.1".into(),
        remote_address: "10.253.0.2".into(),
    };
    assert!(adapter.validate().is_ok());
    let mut dual_transport = adapter.clone();
    dual_transport
        .urls
        .push("turn:127.0.0.1:12346?transport=tcp".into());
    assert!(dual_transport.validate().is_ok());
    for invalid in [
        "turn:192.0.2.1:12346?transport=tcp",
        "turn:127.0.0.1:80?transport=tcp",
        "turn:127.0.0.1:12346?transport=tls",
    ] {
        dual_transport.urls[1] = invalid.into();
        assert!(dual_transport.validate().is_err());
    }
    let public = IceServer {
        urls: vec!["turn:relay.example.test:3478".into()],
        ..Default::default()
    };
    let filtered = direct_servers(&[public.clone(), adapter.clone()]);
    assert_eq!(filtered.len(), 1);
    assert!(filtered[0].native_media);
    let mut forged = adapter.clone();
    forged.urls = public.urls;
    assert!(forged.validate().is_err());
    forged = adapter.clone();
    forged.remote_address = "192.0.2.1".into();
    assert!(forged.validate().is_err());
    forged = adapter;
    forged.credential = "short".into();
    assert!(forged.validate().is_err());
}

async fn fixture(relay_standby: bool) -> Arc<Stream> {
    fixture_with_servers(relay_standby, vec![]).await
}

async fn fixture_with_servers(relay_standby: bool, ice_servers: Vec<IceServer>) -> Arc<Stream> {
    let peer = Arc::new(peer::create(vec![], false).await.unwrap());
    let stream = Arc::new(Stream {
        id: "direct-upgrade-unit-test".into(),
        display: watch::channel(Monitor {
            handle: 0,
            bounds: Bounds {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            },
            info: DisplayInfo {
                id: "fixture".into(),
                name: "fixture".into(),
                width: 1,
                height: 1,
                primary: true,
            },
        })
        .0,
        privacy: mpsc::channel(1).0,
        privacy_pending: Mutex::new(None),
        peer: watch::channel(Arc::clone(&peer)).0,
        initial_peer: Arc::downgrade(&peer),
        upgrades: Mutex::new(Upgrades::default()),
        relay_standby,
        standby: Mutex::new(super::super::relay::Standby::default()),
        ice_servers,
        separate_clipboard: false,
        inputs: mpsc::channel(1).0,
        clipboard_inputs: mpsc::channel(1).0,
        profile: watch::channel(Profile {
            codec: Default::default(),
            adaptive_fps: false,
            adaptive_resolution: false,
            width: 1280,
            fps: 30,
            bitrate: 1_000_000,
        })
        .0,
        connected: watch::channel(true).0,
        cancel: watch::channel(false).0,
        heartbeat: watch::channel(Instant::now()).0,
        stats: Mutex::new(StreamStats::default()),
        last_frame: Mutex::new(Instant::now()),
        audio: Mutex::new(AudioState::Unavailable),
    });
    peer::bind(&stream, &peer);
    stream
}

async fn pending(stream: &Arc<Stream>) -> Arc<Peer> {
    let peer = Arc::new(peer::create(vec![], false).await.unwrap());
    peer::bind(stream, &peer);
    let mut state = stream.upgrades.lock().await;
    state.generation = 1;
    state.pending = Some(Arc::clone(&peer));
    peer
}

async fn connect(host: &Arc<Peer>) -> (Peer, Arc<RTCDataChannel>) {
    let client = peer::create(vec![], false).await.unwrap();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    client.connection.on_data_channel(Box::new(move |channel| {
        let sender = sender.clone();
        let opened_channel = Arc::clone(&channel);
        // Discovery runs before WebRTC opens this endpoint; the host may already be ready.
        channel.on_open(Box::new(move || {
            sender.send(opened_channel).unwrap();
            Box::pin(async {})
        }));
        Box::pin(async {})
    }));
    let mut gathering = host.connection.gathering_complete_promise().await;
    host.offer().await.unwrap();
    gathering.recv().await;
    client
        .connection
        .set_remote_description(host.connection.local_description().await.unwrap())
        .await
        .unwrap();
    let mut gathering = client.connection.gathering_complete_promise().await;
    let answer = client.connection.create_answer(None).await.unwrap();
    client
        .connection
        .set_local_description(answer)
        .await
        .unwrap();
    gathering.recv().await;
    let sdp = client.connection.local_description().await.unwrap().sdp;
    host.connection
        .set_remote_description(RTCSessionDescription::answer(sdp).unwrap())
        .await
        .unwrap();
    let channel = tokio::time::timeout(Duration::from_secs(10), receiver.recv())
        .await
        .unwrap()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while host.controls.ready_state()
            != webrtc::data_channel::data_channel_state::RTCDataChannelState::Open
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    (client, channel)
}

#[tokio::test]
async fn failed_probe_and_stale_requests_never_close_the_active_peer() {
    let stream = fixture(false).await;
    let original = Arc::clone(&stream.peer.borrow());
    let probe = pending(&stream).await;
    assert_eq!(commit(&stream, 1).await.unwrap().committed, Some(false));
    assert!(commit(&stream, 2).await.is_err());
    cancel(&stream, 2).await;
    assert!(stream.upgrades.lock().await.pending.is_some());
    cancel(&stream, 1).await;
    assert_eq!(
        probe.connection.connection_state(),
        RTCPeerConnectionState::Closed
    );
    assert_eq!(commit(&stream, 1).await.unwrap().committed, Some(false));
    assert!(Arc::ptr_eq(&stream.peer.borrow(), &original));
    assert!(!*stream.cancel.borrow());
    stream.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn promotion_is_idempotent_and_retires_the_old_peer_only_after_new_channel_ping() {
    let stream = fixture(false).await;
    let original = Arc::clone(&stream.peer.borrow());
    let probe = pending(&stream).await;
    let (client, channel) = connect(&probe).await;
    assert!(probe.direct().await);
    for _ in 0..2 {
        assert_eq!(commit(&stream, 1).await.unwrap().committed, Some(true));
    }
    cancel(&stream, 1).await;
    assert!(Arc::ptr_eq(&stream.peer.borrow(), &probe));
    assert!(is_retiring(&stream, &original).await);
    assert_ne!(
        original.connection.connection_state(),
        RTCPeerConnectionState::Closed
    );
    channel.send_text(r#"{"kind":"ping"}"#).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while original.connection.connection_state() != RTCPeerConnectionState::Closed {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(!*stream.cancel.borrow());
    assert_eq!(
        probe.connection.connection_state(),
        RTCPeerConnectionState::Connected
    );
    stream.close().await;
    client.close().await;
}

#[test]
fn relay_backup_excludes_native_adapters_and_preserves_public_turn_credentials() {
    let public = IceServer {
        urls: vec!["stun:example.test".into(), "turn:relay.test".into()],
        username: "temporary".into(),
        credential: "credential".into(),
        ..Default::default()
    };
    let native = IceServer {
        native_media: true,
        urls: vec!["turn:127.0.0.1:12345".into()],
        ..Default::default()
    };
    let filtered = super::super::relay::servers(&[public, native]);
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].urls, vec!["turn:relay.test"]);
    assert_eq!(filtered[0].username, "temporary");
    assert_eq!(filtered[0].credential, "credential");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn backup_heartbeats_and_activation_preserve_capture_and_do_not_warm_duplicate_media() {
    let stream = fixture(true).await;
    let original = Arc::clone(&stream.peer.borrow());
    let (direct_client, _) = connect(&original).await;
    let backup = Arc::new(peer::create(vec![], false).await.unwrap());
    peer::bind(&stream, &backup);
    let (relay_client, channel) = connect(&backup).await;
    super::super::relay::retain(&stream, Arc::clone(&backup)).await;
    assert!(auxiliary(&stream).await.is_none());
    let (sender, mut receiver) = mpsc::unbounded_channel();
    channel.on_message(Box::new(move |message| {
        sender.send(message.data).unwrap();
        Box::pin(async {})
    }));
    channel
        .send_text(r#"{"kind":"standby-ping"}"#)
        .await
        .unwrap();
    let pong = tokio::time::timeout(Duration::from_secs(5), receiver.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pong.as_ref(), br#"{"kind":"standby-pong"}"#);
    assert!(Arc::ptr_eq(&stream.peer.borrow(), &original));
    channel
        .send_text(r#"{"kind":"standby-activate"}"#)
        .await
        .unwrap();
    let activated = tokio::time::timeout(Duration::from_secs(5), receiver.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(activated.as_ref(), br#"{"kind":"standby-active"}"#);
    assert!(Arc::ptr_eq(&stream.peer.borrow(), &backup));
    assert!(!*stream.cancel.borrow());
    assert_eq!(
        original.connection.connection_state(),
        RTCPeerConnectionState::Closed
    );
    stream.close().await;
    assert_eq!(
        backup.connection.connection_state(),
        RTCPeerConnectionState::Closed
    );
    direct_client.close().await;
    relay_client.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn closing_the_active_peer_switches_to_the_backup_instead_of_cancelling_capture() {
    let stream = fixture(true).await;
    let original = Arc::clone(&stream.peer.borrow());
    let (direct_client, _) = connect(&original).await;
    let backup = Arc::new(peer::create(vec![], false).await.unwrap());
    peer::bind(&stream, &backup);
    let (relay_client, _) = connect(&backup).await;
    super::super::relay::retain(&stream, Arc::clone(&backup)).await;
    original.close().await;
    tokio::time::timeout(Duration::from_secs(5), async {
        while !Arc::ptr_eq(&stream.peer.borrow(), &backup) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(!*stream.cancel.borrow());
    assert!(super::super::relay::recover(&stream, &original).await);
    assert!(!super::super::relay::recover(&stream, &backup).await);
    stream.close().await;
    direct_client.close().await;
    relay_client.close().await;
}

#[tokio::test]
async fn retaining_a_relay_invalidates_a_pending_backup_commit() {
    let stream = fixture_with_servers(
        true,
        vec![IceServer {
            urls: vec!["turn:127.0.0.1:9".into()],
            username: "fixture".into(),
            credential: "fixture".into(),
            ..Default::default()
        }],
    )
    .await;
    // Match the authorization lease normally created before a native stream starts.
    let lease = crate::remote_desktop::SESSION.get_or_init(|| std::sync::Mutex::new(None));
    let previous_lease = lease
        .lock()
        .unwrap()
        .replace(crate::remote_desktop::Session {
            permissions: crate::remote_desktop::permissions::Permissions::default(),
            id: stream.id.clone(),
            touched: Instant::now(),
            deadline: Instant::now() + Duration::from_secs(60),
            clipboard: None,
            display: stream.display.borrow().clone(),
            privacy: None,
            input: Default::default(),
        });
    let standby_signal = |action| {
        serde_json::from_value::<SignalRequest>(serde_json::json!({
            "id": "direct-upgrade-unit-test",
            "candidates": [], "relayStandby": { "generation": 1, "action": action }
        }))
        .unwrap()
    };
    let offer = stream.signal(standby_signal("start")).await.unwrap();
    assert!(offer.sdp.is_some());
    let original = Arc::clone(&stream.peer.borrow());
    super::super::relay::retain(&stream, Arc::clone(&original)).await;
    assert!(stream.signal(standby_signal("commit")).await.is_err());
    assert!(Arc::ptr_eq(&stream.peer.borrow(), &original));
    assert!(!*stream.cancel.borrow());
    stream.close().await;
    *lease.lock().unwrap() = previous_lease;
}
