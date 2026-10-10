use super::*;
use easytier::common::config::ConfigLoader;
use hickory_proto::rr::{
    rdata::{A, AAAA},
    Record,
};

fn interface() -> Interface {
    Interface {
        name: "test".into(),
        index: 1,
        ipv4: Ipv4Addr::new(192, 0, 2, 1),
        dns: Vec::new(),
    }
}

fn config(servers: &[&str]) -> Config {
    Config {
        session_id: "dns-fallback".into(),
        secret: "ab".repeat(32),
        servers: servers.iter().map(|server| (*server).into()).collect(),
        stun_servers: Vec::new(),
        desktop: false,
        expires_at: crate::lease::now_ms() + 60_000,
    }
}

#[tokio::test]
async fn failed_coordinator_dns_preserves_the_usable_ip_and_engine_startup() {
    let mut config = config(&["udp://unavailable.example:11010", "udp://192.0.2.2:11010"]);
    resolve_config(&mut config, &interface()).await.unwrap();
    assert_eq!(config.servers, ["udp://192.0.2.2:11010"]);
    let core = config.core().unwrap();
    let mut flags = core.get_flags();
    flags.disable_upnp = true;
    core.set_flags(flags);
    let engine = crate::tests::engine(core);
    engine.start().await.unwrap();
    engine.stop().await;
}

#[tokio::test]
async fn no_resolvable_coordinator_fails_without_mutating_the_grant() {
    let mut config = config(&["udp://unavailable.example:11010"]);
    assert!(matches!(
        resolve_config(&mut config, &interface()).await,
        Err(Error::Unavailable)
    ));
    assert_eq!(config.servers, ["udp://unavailable.example:11010"]);
}

fn response_for(query: Query) -> Result<Vec<IpAddr>> {
    let mut request = Message::new();
    request.set_id(42).add_query(query.clone());
    let mut response = Message::from_vec(&request.to_vec().unwrap()).unwrap();
    response.set_message_type(MessageType::Response);
    let address = match query.query_type() {
        RecordType::A => RData::A(A(Ipv4Addr::new(192, 0, 2, 3))),
        RecordType::AAAA => RData::AAAA(AAAA("2001:db8::3".parse().unwrap())),
        other => panic!("Unexpected query type {other}"),
    };
    response.add_answer(Record::from_rdata(query.name().clone(), 30, address));
    let response = Message::from_vec(&response.to_vec().unwrap()).unwrap();
    addresses(&request, &response)
}

#[tokio::test]
async fn dual_stack_dns_answers_reach_the_matching_stun_probes() {
    let addresses = resolve_records("stun.example", |query| async { response_for(query) })
        .await
        .unwrap();
    assert_eq!(addresses.len(), 2);
    let resolved = vec![addresses
        .into_iter()
        .map(|ip| SocketAddr::new(ip, 3478))
        .collect()];
    let mut config = config(&["udp://192.0.2.2:11010"]);
    config.stun_servers = sample_endpoints(&resolved);
    let core = config.core().unwrap();
    assert_eq!(core.get_stun_servers().unwrap(), ["192.0.2.3:3478"]);
    assert_eq!(core.get_tcp_stun_servers().unwrap(), ["192.0.2.3:3478"]);
    assert_eq!(core.get_stun_servers_v6().unwrap(), ["[2001:db8::3]:3478"]);
}

#[tokio::test]
async fn one_dns_family_failure_preserves_the_other() {
    for unavailable in [RecordType::A, RecordType::AAAA] {
        let addresses = resolve_records("stun.example", |query| async move {
            if query.query_type() == unavailable {
                Err(Error::Unavailable)
            } else {
                response_for(query)
            }
        })
        .await
        .unwrap();
        assert_eq!(addresses.len(), 1);
        assert_eq!(addresses[0].is_ipv6(), unavailable == RecordType::A);
    }
}

#[tokio::test]
async fn supplemental_dns_failures_preserve_reachable_configured_stun_servers() {
    let interface = interface();
    let servers = vec!["192.0.2.2:3478".into(), "unavailable.example:3478".into()];
    assert_eq!(
        resolve_stun(&servers, &interface).await.unwrap(),
        ["192.0.2.2:3478"]
    );
    assert!(resolve_stun(&servers[1..], &interface).await.is_err());
    assert!(resolve_stun(&["198.18.0.2:3478".into()], &interface)
        .await
        .is_err());
}

#[test]
fn accepts_wire_decoded_responses_for_hosts_without_a_trailing_dot() {
    let mut request = Message::new();
    request
        .set_id(42)
        .add_query(dns_query("stun.example", RecordType::A).unwrap());
    let mut response = Message::from_vec(&request.to_vec().unwrap()).unwrap();
    response.set_message_type(MessageType::Response);
    response.add_answer(Record::from_rdata(
        Name::from_ascii("stun.example.").unwrap(),
        30,
        RData::A(A(Ipv4Addr::new(192, 0, 2, 3))),
    ));
    let response = Message::from_vec(&response.to_vec().unwrap()).unwrap();
    assert_eq!(
        addresses(&request, &response).unwrap(),
        [IpAddr::V4(Ipv4Addr::new(192, 0, 2, 3))]
    );
}

#[test]
fn samples_each_server_before_alternatives_and_deduplicates() {
    let endpoint = |last| SocketAddr::from(([192, 0, 2, last], 3478));
    let servers = vec![
        vec![endpoint(1), endpoint(2), endpoint(3)],
        vec![endpoint(4), endpoint(1)],
        vec![],
        vec![endpoint(5)],
    ];
    assert_eq!(
        sample_endpoints(&servers),
        [1, 4, 5, 2, 3].map(|last| endpoint(last).to_string())
    );
    let many = vec![(1..20).map(endpoint).collect()];
    assert_eq!(sample_endpoints(&many).len(), MAX_STUN_ENDPOINTS);
}

#[test]
fn large_ipv4_answer_sets_cannot_starve_ipv6_sampling() {
    let mut resolved: Vec<_> = (1..20)
        .map(|last| vec![SocketAddr::from(([192, 0, 2, last], 3478))])
        .collect();
    let ipv6 = "[2001:db8::3]:3478";
    resolved[0].push(ipv6.parse().unwrap());
    let endpoints = sample_endpoints(&resolved);
    assert_eq!(endpoints.len(), MAX_STUN_ENDPOINTS);
    assert_eq!(endpoints[0], "192.0.2.1:3478");
    assert_eq!(endpoints[1], ipv6);
    assert_eq!(endpoints[2], "192.0.2.2:3478");
}

#[test]
fn unresolved_domains_remain_available_to_both_stun_probes() {
    let mut config = config(&["udp://192.0.2.2:11010"]);
    config.stun_servers = vec!["stun.example:3478".into()];
    let core = config.core().unwrap();
    assert_eq!(core.get_stun_servers().unwrap(), ["stun.example:3478"]);
    assert_eq!(core.get_stun_servers_v6().unwrap(), ["stun.example:3478"]);
    config.stun_servers.clear();
    let core = config.core().unwrap();
    assert!(core.get_stun_servers().unwrap().is_empty());
    assert!(core.get_stun_servers_v6().unwrap().is_empty());
}

#[test]
fn ignores_unrelated_answers_and_follows_cname_chains() {
    use hickory_proto::rr::rdata::CNAME;
    let name = Name::from_ascii("stun.example").unwrap();
    let alias = Name::from_ascii("alias.example").unwrap();
    let mut request = Message::new();
    request
        .set_id(42)
        .add_query(Query::query(name.clone(), RecordType::A));
    let mut response = request.clone();
    response.set_message_type(MessageType::Response);
    response.add_answer(Record::from_rdata(
        alias.clone(),
        30,
        RData::A(A(Ipv4Addr::new(192, 0, 2, 3))),
    ));
    assert!(addresses(&request, &response).is_err());
    response.add_answer(Record::from_rdata(name, 30, RData::CNAME(CNAME(alias))));
    assert_eq!(
        addresses(&request, &response).unwrap(),
        [IpAddr::V4(Ipv4Addr::new(192, 0, 2, 3))]
    );
}

#[test]
fn validates_dns_transaction_and_rejects_synthetic_answers() {
    let query = Query::query(Name::from_ascii("stun.example").unwrap(), RecordType::A);
    let mut request = Message::new();
    request.set_id(42).add_query(query);
    let mut response = request.clone();
    response.set_message_type(MessageType::Response);
    response.add_answer(Record::from_rdata(
        Name::from_ascii("stun.example").unwrap(),
        30,
        RData::A(A(Ipv4Addr::new(198, 18, 0, 2))),
    ));
    assert!(addresses(&request, &response).is_err());
    response.add_answer(Record::from_rdata(
        Name::from_ascii("stun.example").unwrap(),
        30,
        RData::A(A(Ipv4Addr::new(192, 0, 2, 3))),
    ));
    assert_eq!(
        addresses(&request, &response).unwrap(),
        [IpAddr::V4(Ipv4Addr::new(192, 0, 2, 3))]
    );
    response.set_id(43);
    assert!(addresses(&request, &response).is_err());
}
