use async_trait::async_trait;

use super::*;
use crate::host::dns::DnsSrvRecord;

struct SplitDns(Vec<IpAddr>);

#[async_trait]
impl DnsResolver for SplitDns {
    async fn resolve(&self, _query: DnsQuery) -> anyhow::Result<Vec<IpAddr>> {
        Ok(self.0.clone())
    }
}

#[async_trait]
impl DnsRecordResolver for SplitDns {
    async fn resolve_txt(&self, _query: DnsQuery) -> anyhow::Result<String> {
        Ok("198.18.14.57:3478 192.0.2.1:3478 192.0.2.2:3478".into())
    }

    async fn resolve_srv(&self, _query: DnsQuery) -> anyhow::Result<Vec<DnsSrvRecord>> {
        Ok(Vec::new())
    }
}

fn resolver(endpoints: &[&str], answers: &[&str], ipv6: bool) -> HostResolverIter<SplitDns> {
    HostResolverIter::new(
        Arc::new(SplitDns(
            answers.iter().map(|ip| ip.parse().unwrap()).collect(),
        )),
        SocketContext::default(),
        endpoints.iter().map(|value| (*value).into()).collect(),
        1,
        ipv6,
    )
}

#[tokio::test]
async fn proxied_server_does_not_hide_later_direct_servers() {
    let mut resolver = resolver(
        &["proxy.example:3478", "192.0.2.1:3478", "192.0.2.2:3478"],
        &["198.18.14.57"],
        false,
    );
    assert_eq!(
        resolver.next().await,
        Some("192.0.2.1:3478".parse().unwrap())
    );
    assert_eq!(
        resolver.next().await,
        Some("192.0.2.2:3478".parse().unwrap())
    );
    assert_eq!(resolver.next().await, None);
}

#[tokio::test]
async fn filters_before_the_per_domain_sample_limit() {
    let mut resolver = resolver(
        &["mixed.example:3478"],
        &["198.18.0.1", "198.19.255.255", "192.0.2.1"],
        false,
    );
    assert_eq!(
        resolver.next().await,
        Some("192.0.2.1:3478".parse().unwrap())
    );
    assert_eq!(resolver.next().await, None);
}

#[tokio::test]
async fn explicit_and_txt_endpoints_use_the_same_filter() {
    let mut resolver = resolver(&["198.19.0.1:3478", "txt:stun.example"], &[], false);
    assert_eq!(
        resolver.next().await,
        Some("192.0.2.1:3478".parse().unwrap())
    );
    assert_eq!(
        resolver.next().await,
        Some("192.0.2.2:3478".parse().unwrap())
    );
    assert_eq!(resolver.next().await, None);
}

#[tokio::test]
async fn mapped_fake_ipv6_does_not_hide_native_ipv6() {
    let mut resolver = resolver(
        &["[::ffff:198.18.14.57]:3478", "mixed.example:3478"],
        &["::ffff:198.19.0.1", "2001:db8::1"],
        true,
    );
    assert_eq!(
        resolver.next().await,
        Some("[2001:db8::1]:3478".parse().unwrap())
    );
    assert_eq!(resolver.next().await, None);
}

#[tokio::test]
async fn fake_only_configuration_yields_no_direct_mapping_target() {
    let mut resolver = resolver(
        &["proxy.example:3478", "198.18.0.2:3478"],
        &["198.18.14.57"],
        false,
    );
    assert_eq!(resolver.next().await, None);
}

fn response(server: &str, mapping: &str) -> BindRequestResponse {
    BindRequestResponse {
        local_addr: "0.0.0.0:40000".parse().unwrap(),
        stun_server_addr: server.parse().unwrap(),
        recv_from_addr: server.parse().unwrap(),
        mapped_socket_addr: Some(mapping.parse().unwrap()),
        changed_socket_addr: None,
        change_ip: false,
        change_port: false,
        real_ip_changed: false,
        real_port_changed: false,
        latency_us: 1_000,
    }
}

#[test]
fn real_multiple_exits_and_symmetric_mappings_remain_conservative() {
    for transport in [StunTransport::Udp, StunTransport::Tcp] {
        for second_mapping in ["198.51.100.2:40000", "198.51.100.1:50000"] {
            let result = StunNatTypeDetectResult::new(
                transport,
                "0.0.0.0:40000".parse().unwrap(),
                vec![
                    response("192.0.2.1:3478", "198.51.100.1:41000"),
                    response("192.0.2.2:3478", second_mapping),
                ],
            );
            assert_eq!(result.nat_type(), NatType::Symmetric);
        }
    }
}

#[test]
fn matching_direct_mappings_need_two_independent_observations() {
    for transport in [StunTransport::Udp, StunTransport::Tcp] {
        let mut result = StunNatTypeDetectResult::new(
            transport,
            "0.0.0.0:40000".parse().unwrap(),
            vec![response("192.0.2.1:3478", "198.51.100.1:41000")],
        );
        assert_eq!(result.nat_type(), NatType::Unknown);
        result
            .stun_resps
            .push(response("192.0.2.2:3478", "198.51.100.1:41000"));
        let expected = if transport == StunTransport::Udp {
            NatType::PortRestricted
        } else {
            NatType::FullCone
        };
        assert_eq!(result.nat_type(), expected);
    }
}
