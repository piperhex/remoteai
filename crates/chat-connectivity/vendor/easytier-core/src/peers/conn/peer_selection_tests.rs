use super::*;
use std::time::Duration;

use crate::{
    peers::{
        conn::peer_session::PeerSessionStore, create_packet_recv_chan,
        test_support::NoopPeerContext,
    },
    tunnel::ring::create_ring_tunnel_pair,
};

async fn admitted_pair() -> (PeerConn, PeerConn) {
    let (local_tunnel, remote_tunnel) = create_ring_tunnel_pair();
    let sessions = Arc::new(PeerSessionStore::new());
    let context = Arc::new(NoopPeerContext::default());
    let mut local = PeerConn::new(1, context.clone(), local_tunnel, sessions.clone());
    let mut remote = PeerConn::new(2, context, remote_tunnel, sessions);
    let (outgoing, incoming) = tokio::join!(
        local.do_handshake_as_client(),
        remote.do_handshake_as_server_ext(|_, _| Ok(()))
    );
    outgoing.unwrap();
    incoming.unwrap();
    (local, remote)
}

fn peer(remote_id: u32) -> Peer {
    let (sender, _receiver) = create_packet_recv_chan();
    Peer::new(remote_id, sender, Arc::new(NoopPeerContext::default()))
}

async fn verified_pair() -> (Peer, Peer, PeerConnId) {
    let (local_conn, remote_conn) = admitted_pair().await;
    let id = local_conn.get_conn_id();
    let (local, remote) = (peer(2), peer(1));
    local.add_peer_conn(local_conn).await.unwrap();
    remote.add_peer_conn(remote_conn).await.unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        while local.conns.get(&id).unwrap().get_stats().latency_us == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the admitted connection must complete a real round trip");
    (local, remote, id)
}

#[tokio::test]
async fn readiness_selects_a_connection_before_application_traffic_and_after_cache_expiry() {
    let (local, _remote, id) = verified_pair().await;
    assert!(local.default_conn.load().is_none());
    assert_eq!(local.get_default_conn_id(), id);

    // Deterministically reproduce the periodic invalidation without racing a timer.
    local.default_conn.store(None);
    assert_eq!(local.get_default_conn_id(), id);
    assert_eq!(local.select_conn().unwrap().get_conn_id(), id);
}

#[tokio::test]
async fn newly_admitted_socket_cannot_hide_a_verified_connection() {
    let (local, _remote, verified_id) = verified_pair().await;
    let (mut unverified, _unverified_remote) = admitted_pair().await;
    unverified.set_is_hole_punched(false);
    let unverified = Arc::new(unverified);
    assert_eq!(unverified.get_stats().latency_us, 0);
    local
        .conns
        .insert(unverified.get_conn_id(), unverified.clone());

    local.default_conn.store(None);
    assert_eq!(local.get_default_conn_id(), verified_id);
    // An initial packet can select a new socket before any path has been measured.
    local.default_conn.store(Some(unverified));
    assert_eq!(local.get_default_conn_id(), verified_id);
}

#[tokio::test]
async fn empty_peer_has_no_selected_connection() {
    assert!(peer(2).get_default_conn_id().is_nil());
}
