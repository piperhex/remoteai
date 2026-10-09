use std::net::SocketAddr;

use easytier_proto::common::{TunnelInfo, Url};
use tokio::net::UdpSocket;

use super::RouteEndpoint;

fn socket_address(address: &Url) -> Option<SocketAddr> {
    let address = url::Url::parse(&address.url).ok()?;
    let ip = match address.host()? {
        url::Host::Ipv4(ip) => ip.into(),
        url::Host::Ipv6(ip) => ip.into(),
        url::Host::Domain(host) => host.parse().ok()?,
    };
    Some(SocketAddr::new(
        ip,
        address.port().filter(|port| *port > 0)?,
    ))
}

pub(super) fn endpoint(address: &Url) -> Option<RouteEndpoint> {
    let address = socket_address(address)?;
    (!address.ip().is_unspecified()).then(|| RouteEndpoint {
        host: address.ip().to_string(),
        port: address.port(),
    })
}

/// Resolve a wildcard UDP binding using the OS route to the selected physical peer.
pub(super) async fn resolve_udp_binding(
    tunnel: &TunnelInfo,
    source: Option<std::net::Ipv4Addr>,
) -> Option<RouteEndpoint> {
    if tunnel.tunnel_type != "udp" {
        return None;
    }
    let binding = socket_address(tunnel.local_addr.as_ref()?)?;
    let remote = socket_address(
        tunnel
            .resolved_remote_addr
            .as_ref()
            .or(tunnel.remote_addr.as_ref())?,
    )?;
    if !binding.ip().is_unspecified()
        || remote.ip().is_unspecified()
        || binding.is_ipv4() != remote.is_ipv4()
    {
        return None;
    }
    if binding.is_ipv4() {
        if let Some(source) = source {
            return Some(RouteEndpoint {
                host: source.to_string(),
                port: binding.port(),
            });
        }
    }
    // Without an interface override, UDP connect asks the OS for the source IP
    // without sending packets or changing the shared tunnel socket's peer filter.
    // The temporary socket's port is unrelated; retain the selected tunnel's port.
    // Lookup failures leave only this optional detail unavailable, not the chat route.
    let socket = UdpSocket::bind(SocketAddr::new(binding.ip(), 0))
        .await
        .ok()?;
    socket.connect(remote).await.ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_unspecified()).then(|| RouteEndpoint {
        host: ip.to_string(),
        port: binding.port(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tunnel(local: &str, remote: &str) -> TunnelInfo {
        TunnelInfo {
            tunnel_type: "udp".into(),
            local_addr: Some(Url { url: local.into() }),
            remote_addr: Some(Url { url: remote.into() }),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn uses_the_resolved_peer_and_preserves_the_tunnel_port_without_sending() {
        let receiver = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let mut info = tunnel("udp://0.0.0.0:45678", "udp://unresolved.example:1234");
        info.resolved_remote_addr = Some(Url {
            url: format!("udp://{}", receiver.local_addr().unwrap()),
        });
        assert_eq!(
            resolve_udp_binding(&info, None).await,
            Some(RouteEndpoint {
                host: "127.0.0.1".into(),
                port: 45678,
            })
        );
        let mut buffer = [0; 1];
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(50),
            receiver.recv_from(&mut buffer)
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn never_invents_missing_ports_peers_or_explicit_source_bindings() {
        for (local, remote) in [
            ("udp://0.0.0.0:0", "udp://127.0.0.1:1234"),
            ("udp://0.0.0.0", "udp://127.0.0.1:1234"),
            ("udp://192.0.2.1:45678", "udp://127.0.0.1:1234"),
            ("udp://0.0.0.0:45678", "udp://hidden.example:1234"),
            ("udp://0.0.0.0:45678", "udp://0.0.0.0:1234"),
            ("udp://0.0.0.0:45678", "udp://127.0.0.1:0"),
            ("udp://0.0.0.0:45678", "udp://[::1]:1234"),
            ("udp://[::]:45678", "udp://127.0.0.1:1234"),
        ] {
            assert_eq!(
                resolve_udp_binding(&tunnel(local, remote), None).await,
                None
            );
        }
        let mut info = tunnel("tcp://0.0.0.0:45678", "tcp://127.0.0.1:1234");
        info.tunnel_type = "tcp".into();
        assert_eq!(resolve_udp_binding(&info, None).await, None);
        info = tunnel("udp://0.0.0.0:45678", "udp://127.0.0.1:1234");
        info.local_addr = None;
        assert_eq!(resolve_udp_binding(&info, None).await, None);
    }

    #[tokio::test]
    async fn selected_interface_only_fills_a_wildcard_ipv4_source() {
        let source = Some("192.0.2.5".parse().unwrap());
        let info = tunnel("udp://0.0.0.0:45678", "udp://192.0.2.9:1234");
        assert_eq!(
            resolve_udp_binding(&info, source).await,
            Some(RouteEndpoint {
                host: "192.0.2.5".into(),
                port: 45678
            })
        );
        let info = tunnel("udp://192.0.2.6:45678", "udp://192.0.2.9:1234");
        assert_eq!(resolve_udp_binding(&info, source).await, None);
        let info = tunnel("udp://[::]:45678", "udp://[::1]:1234");
        assert_eq!(
            resolve_udp_binding(&info, source).await.unwrap().host,
            "::1"
        );
    }
}
