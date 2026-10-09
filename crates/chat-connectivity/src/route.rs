use easytier::instance::factory::NativeCoreInstance;
use easytier_core::peers::peer_manager::PeerSnapshot;
use easytier_proto::core_peer::peer::{PeerConnInfo, Route};
use serde::Serialize;

mod endpoints;
use endpoints::endpoint;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod udp_tests;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteStatus {
    pub direct: bool,
    pub protocol: Option<String>,
    pub ipv6: bool,
    pub rtt_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_endpoint: Option<RouteEndpoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_endpoint: Option<RouteEndpoint>,
}

/// IP and port of the selected physical tunnel, for local connection details only.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RouteEndpoint {
    pub host: String,
    pub port: u16,
}

/// A private virtual address reachable through a rendezvous relay must never count as P2P.
pub async fn status(instance: &NativeCoreInstance, remote_name: &str) -> RouteStatus {
    status_with_source(instance, remote_name, None).await
}

pub(crate) async fn status_with_source(
    instance: &NativeCoreInstance,
    remote_name: &str,
    source: Option<std::net::Ipv4Addr>,
) -> RouteStatus {
    let routes = instance.route_snapshots().await;
    let peers = instance.peer_snapshots().await;
    let mut status = from_snapshots(&routes, &peers, remote_name);
    if status.local_endpoint.is_none() {
        if let Some(tunnel) = routed_connection(&routes, &peers, remote_name)
            .and_then(|connection| connection.tunnel.as_ref())
        {
            status.local_endpoint = endpoints::resolve_udp_binding(tunnel, source).await;
        }
    }
    status
}

fn routed_connection<'a>(
    routes: &[Route],
    peers: &'a [PeerSnapshot],
    remote_name: &str,
) -> Option<&'a PeerConnInfo> {
    let route = routes.iter().find(|route| {
        route.hostname == remote_name && route.cost == 1 && route.next_hop_peer_id == route.peer_id
    })?;
    selected_connection(peers.iter().find(|peer| peer.peer_id == route.peer_id)?)
}

pub(super) fn from_snapshots(
    routes: &[Route],
    peers: &[PeerSnapshot],
    remote_name: &str,
) -> RouteStatus {
    let Some(connection) = routed_connection(routes, peers, remote_name) else {
        return RouteStatus::default();
    };
    let tunnel = connection.tunnel.as_ref();
    RouteStatus {
        direct: true,
        protocol: connection
            .tunnel
            .as_ref()
            .map(|tunnel| tunnel.tunnel_type.clone()),
        ipv6: uses_ipv6(connection),
        rtt_ms: connection
            .stats
            .as_ref()
            .map(|stats| stats.latency_us / 1000),
        local_endpoint: tunnel
            .and_then(|tunnel| tunnel.local_addr.as_ref())
            .and_then(endpoint),
        remote_endpoint: tunnel
            .and_then(|tunnel| {
                tunnel
                    .resolved_remote_addr
                    .as_ref()
                    .or(tunnel.remote_addr.as_ref())
            })
            .and_then(endpoint),
    }
}

/// The selected peer socket must have completed a round trip, not just transport admission.
pub(super) fn selected_connection(peer: &PeerSnapshot) -> Option<&PeerConnInfo> {
    let selected_id = peer.default_conn_id?.to_string();
    // EasyTier's directly_connected_conns lists only non-punched sockets. Punched sockets
    // are also peer-to-peer; relay exclusion belongs to the one-hop route check above.
    peer.conns.iter().find(|connection| {
        connection.conn_id == selected_id
            && connection.peer_id == peer.peer_id
            && !connection.is_closed
            && connection
                .stats
                .as_ref()
                .is_some_and(|stats| stats.latency_us > 0)
    })
}

fn uses_ipv6(connection: &PeerConnInfo) -> bool {
    connection
        .tunnel
        .as_ref()
        .and_then(|tunnel| {
            tunnel
                .resolved_remote_addr
                .as_ref()
                .or(tunnel.remote_addr.as_ref())
        })
        .and_then(|address| url::Url::parse(&address.url).ok())
        .is_some_and(|address| matches!(address.host(), Some(url::Host::Ipv6(_))))
}
