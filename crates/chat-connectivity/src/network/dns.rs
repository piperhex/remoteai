//! Resolve only authenticated rendezvous/STUN hosts over the selected adapter's DNS path.
use std::{
    collections::BTreeSet,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    time::Duration,
};

use hickory_proto::{
    op::{Message, MessageType, Query, ResponseCode},
    rr::{Name, RData, RecordType},
};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;
use windows_sys::Win32::Networking::WinSock::{
    setsockopt, WSAGetLastError, IPPROTO_IP, IP_UNICAST_IF,
};

use super::windows::Interface;
use crate::{Config, Error, Result};

const DNS_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_STUN_ENDPOINTS: usize = 8;

pub(super) async fn resolve_config(config: &mut Config, interface: &Interface) -> Result<()> {
    config.stun_servers = resolve_stun(&config.stun_servers, interface).await?;
    for server in &mut config.servers {
        let mut url = url::Url::parse(server).map_err(|_| Error::Invalid)?;
        let host = url
            .host_str()
            .ok_or(Error::Invalid)?
            .trim_matches(['[', ']']);
        if host.parse::<IpAddr>().is_ok() {
            continue;
        }
        let address = resolve(host, interface)
            .await?
            .into_iter()
            .next()
            .ok_or(Error::Unavailable)?;
        url.set_ip_host(address).map_err(|_| Error::Invalid)?;
        *server = url.to_string();
    }
    Ok(())
}

async fn resolve_stun(servers: &[String], interface: &Interface) -> Result<Vec<String>> {
    let mut resolved = Vec::new();
    for endpoint in servers {
        let url = url::Url::parse(&format!("udp://{endpoint}")).map_err(|_| Error::Invalid)?;
        let host = url
            .host_str()
            .ok_or(Error::Invalid)?
            .trim_matches(['[', ']']);
        let port = url.port().ok_or(Error::Invalid)?;
        // Supplemental STUN outages must not discard reachable configured servers.
        if let Ok(addresses) = resolve(host, interface).await {
            resolved.push(
                addresses
                    .into_iter()
                    .map(|address| SocketAddr::new(address, port).to_string())
                    .collect(),
            );
        }
    }
    let endpoints = sample_endpoints(&resolved);
    if !servers.is_empty() && endpoints.is_empty() {
        return Err(Error::Unavailable);
    }
    Ok(endpoints)
}

fn sample_endpoints(resolved: &[Vec<String>]) -> Vec<String> {
    // Sample every configured server before adding its alternative addresses.
    let mut seen = BTreeSet::new();
    (0..MAX_STUN_ENDPOINTS)
        .flat_map(|index| resolved.iter().filter_map(move |server| server.get(index)))
        .filter(|endpoint| seen.insert(*endpoint))
        .take(MAX_STUN_ENDPOINTS)
        .cloned()
        .collect()
}

async fn resolve(host: &str, interface: &Interface) -> Result<Vec<IpAddr>> {
    if let Ok(address) = host.parse::<IpAddr>() {
        if matches!(address, IpAddr::V4(ip) if !super::windows::usable(ip)) {
            return Err(Error::Unavailable);
        }
        return Ok(vec![address]);
    }
    let query = dns_query(host)?;
    for server in interface.dns.iter().take(3) {
        let response =
            tokio::time::timeout(DNS_TIMEOUT, query_server(&query, *server, interface)).await;
        if let Ok(Ok(addresses)) = response {
            return Ok(addresses);
        }
    }
    Err(Error::Unavailable)
}

fn dns_query(host: &str) -> Result<Query> {
    let mut name = Name::from_ascii(host).map_err(|_| Error::Invalid)?;
    // Wire-decoded DNS names always include the root label; equality also checks this flag.
    name.set_fqdn(true);
    Ok(Query::query(name, RecordType::A))
}

async fn query_server(
    query: &Query,
    server: Ipv4Addr,
    interface: &Interface,
) -> Result<Vec<IpAddr>> {
    let socket = dns_socket(interface).map_err(|_| Error::Unavailable)?;
    let mut request = Message::new();
    request
        .set_id(rand::random())
        .set_recursion_desired(true)
        .add_query(query.clone());
    socket
        .connect(SocketAddr::from((server, 53)))
        .await
        .map_err(|_| Error::Unavailable)?;
    socket
        .send(&request.to_vec().map_err(|_| Error::Invalid)?)
        .await
        .map_err(|_| Error::Unavailable)?;
    let mut buffer = [0; 4096];
    let length = socket
        .recv(&mut buffer)
        .await
        .map_err(|_| Error::Unavailable)?;
    let response = Message::from_vec(&buffer[..length]).map_err(|_| Error::Unavailable)?;
    addresses(&request, &response)
}

fn addresses(request: &Message, response: &Message) -> Result<Vec<IpAddr>> {
    if response.id() != request.id()
        || response.message_type() != MessageType::Response
        || response.response_code() != ResponseCode::NoError
        || response.truncated()
        || response.queries() != request.queries()
    {
        return Err(Error::Unavailable);
    }
    let names = answer_names(request, response);
    let addresses: BTreeSet<_> = response
        .answers()
        .iter()
        .filter(|record| names.contains(record.name()))
        .filter_map(|record| match record.data() {
            RData::A(address) if super::windows::usable(address.0) => Some(IpAddr::V4(address.0)),
            _ => None,
        })
        .collect();
    if addresses.is_empty() {
        return Err(Error::Unavailable);
    }
    Ok(addresses.into_iter().collect())
}

fn answer_names(request: &Message, response: &Message) -> BTreeSet<Name> {
    let mut names: BTreeSet<_> = request
        .queries()
        .iter()
        .map(|query| query.name().clone())
        .collect();
    for _ in 0..response.answers().len() {
        let previous = names.len();
        for record in response.answers() {
            if let RData::CNAME(alias) = record.data() {
                if names.contains(record.name()) {
                    names.insert(alias.0.clone());
                }
            }
        }
        if names.len() == previous {
            break;
        }
    }
    names
}

fn dns_socket(interface: &Interface) -> std::io::Result<UdpSocket> {
    use std::os::windows::io::AsRawSocket;
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    let index = interface.index.to_be();
    // SAFETY: the live socket and u32 interface index remain valid for this synchronous Winsock call.
    let result = unsafe {
        setsockopt(
            socket.as_raw_socket() as usize,
            IPPROTO_IP,
            IP_UNICAST_IF,
            (&index as *const u32).cast(),
            std::mem::size_of_val(&index) as i32,
        )
    };
    if result != 0 {
        // SAFETY: immediately reads the error from the failed Winsock call on the same thread.
        return Err(std::io::Error::from_raw_os_error(unsafe {
            WSAGetLastError()
        }));
    }
    socket.bind(&SocketAddr::from((interface.ipv4, 0)).into())?;
    socket.set_nonblocking(true)?;
    UdpSocket::from_std(socket.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use hickory_proto::rr::{rdata::A, Record};

    #[tokio::test]
    async fn supplemental_dns_failures_preserve_reachable_configured_stun_servers() {
        let interface = Interface {
            name: "test".into(),
            index: 1,
            ipv4: Ipv4Addr::new(192, 0, 2, 1),
            dns: Vec::new(),
        };
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
            .add_query(dns_query("stun.example").unwrap());
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
        let servers = vec![
            vec!["a".into(), "b".into(), "c".into()],
            vec!["d".into(), "a".into()],
            vec![],
            vec!["e".into()],
        ];
        assert_eq!(sample_endpoints(&servers), ["a", "d", "e", "b", "c"]);
        let many = vec![(0..20).map(|index| index.to_string()).collect()];
        assert_eq!(sample_endpoints(&many).len(), MAX_STUN_ENDPOINTS);
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
}
