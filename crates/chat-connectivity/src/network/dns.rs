//! Resolve only authenticated rendezvous/STUN hosts over the selected adapter's DNS path.
use std::{
    collections::BTreeSet,
    future::Future,
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
    let stun_servers = resolve_stun(&config.stun_servers, interface).await?;
    let mut servers = Vec::new();
    for server in &config.servers {
        match resolve_server(server, interface).await {
            Ok(server) => servers.push(server),
            // Coordinators are alternatives: a DNS outage must not discard another usable one.
            Err(Error::Unavailable) => continue,
            Err(error) => return Err(error),
        }
    }
    if servers.is_empty() {
        return Err(Error::Unavailable);
    }
    config.stun_servers = stun_servers;
    config.servers = servers;
    Ok(())
}

async fn resolve_server(server: &str, interface: &Interface) -> Result<String> {
    let mut url = url::Url::parse(server).map_err(|_| Error::Invalid)?;
    let host = url
        .host_str()
        .ok_or(Error::Invalid)?
        .trim_matches(['[', ']']);
    if host.parse::<IpAddr>().is_ok() {
        return Ok(server.to_owned());
    }
    let address = resolve(host, interface)
        .await?
        .into_iter()
        .next()
        .ok_or(Error::Unavailable)?;
    url.set_ip_host(address).map_err(|_| Error::Invalid)?;
    Ok(url.to_string())
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
                    .map(|address| SocketAddr::new(address, port))
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

fn sample_endpoints(resolved: &[Vec<SocketAddr>]) -> Vec<String> {
    let ipv4 = sample_family(resolved, false);
    let ipv6 = sample_family(resolved, true);
    // Reserve opportunities for both probes even when one family has many DNS answers.
    (0..MAX_STUN_ENDPOINTS)
        .flat_map(|index| [ipv4.get(index), ipv6.get(index)].into_iter().flatten())
        .take(MAX_STUN_ENDPOINTS)
        .map(ToString::to_string)
        .collect()
}

fn sample_family(resolved: &[Vec<SocketAddr>], ipv6: bool) -> Vec<SocketAddr> {
    let resolved: Vec<Vec<_>> = resolved
        .iter()
        .map(|server| {
            server
                .iter()
                .filter(|address| address.is_ipv6() == ipv6)
                .collect()
        })
        .collect();
    // Sample every configured server before adding its alternative addresses.
    let mut seen = BTreeSet::new();
    (0..MAX_STUN_ENDPOINTS)
        .flat_map(|index| resolved.iter().filter_map(move |server| server.get(index)))
        .filter(|endpoint| seen.insert(**endpoint))
        .take(MAX_STUN_ENDPOINTS)
        .map(|address| **address)
        .collect()
}

async fn resolve(host: &str, interface: &Interface) -> Result<Vec<IpAddr>> {
    resolve_records(host, |query| lookup(query, interface)).await
}

async fn resolve_records<F, Fut>(host: &str, lookup: F) -> Result<Vec<IpAddr>>
where
    F: Fn(Query) -> Fut,
    Fut: Future<Output = Result<Vec<IpAddr>>>,
{
    if let Ok(address) = host.parse::<IpAddr>() {
        if matches!(address, IpAddr::V4(ip) if !super::windows::usable(ip)) {
            return Err(Error::Unavailable);
        }
        return Ok(vec![address]);
    }
    // Missing A or AAAA records must not suppress the usable family or serialize its DNS wait.
    let (ipv4, ipv6) = tokio::join!(
        lookup(dns_query(host, RecordType::A)?),
        lookup(dns_query(host, RecordType::AAAA)?),
    );
    let addresses: Vec<_> = ipv4.into_iter().chain(ipv6).flatten().collect();
    if addresses.is_empty() {
        return Err(Error::Unavailable);
    }
    Ok(addresses)
}

async fn lookup(query: Query, interface: &Interface) -> Result<Vec<IpAddr>> {
    for server in interface.dns.iter().take(3) {
        let response =
            tokio::time::timeout(DNS_TIMEOUT, query_server(&query, *server, interface)).await;
        if let Ok(Ok(addresses)) = response {
            return Ok(addresses);
        }
    }
    Err(Error::Unavailable)
}

fn dns_query(host: &str, record_type: RecordType) -> Result<Query> {
    let mut name = Name::from_ascii(host).map_err(|_| Error::Invalid)?;
    // Wire-decoded DNS names always include the root label; equality also checks this flag.
    name.set_fqdn(true);
    Ok(Query::query(name, record_type))
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
    let record_type = request
        .queries()
        .first()
        .ok_or(Error::Invalid)?
        .query_type();
    let addresses: BTreeSet<_> = response
        .answers()
        .iter()
        .filter(|record| names.contains(record.name()))
        .filter_map(|record| match (record_type, record.data()) {
            (RecordType::A, RData::A(address)) if super::windows::usable(address.0) => {
                Some(IpAddr::V4(address.0))
            }
            (RecordType::AAAA, RData::AAAA(address)) => Some(IpAddr::V6(address.0)),
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
#[path = "dns_tests.rs"]
mod tests;
