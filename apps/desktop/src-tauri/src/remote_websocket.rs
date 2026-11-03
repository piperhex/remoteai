//! Shared cloud WebSocket dialing, including the application's HTTP proxy configuration.
pub(crate) mod backoff;
use base64::Engine;
use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::Duration,
};
use tungstenite::{client, client_tls, stream::MaybeTlsStream, WebSocket};
use url::Url;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const ADDRESS_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) fn connect_remote_websocket(
    websocket_url: &str,
) -> Result<
    (
        WebSocket<MaybeTlsStream<TcpStream>>,
        tungstenite::handshake::client::Response,
    ),
    String,
> {
    let target = Url::parse(websocket_url)
        .map_err(|error| format!("Invalid remote control WebSocket URL: {error}"))?;
    let proxy_target = proxy_lookup_url(&target)?;
    let Some(proxy_url) = crate::system_proxy::proxy_for_target(&proxy_target) else {
        return handshake(
            websocket_url,
            direct_stream(&target)?,
            target.scheme() == "wss",
        );
    };
    if proxy_url.scheme() != "http" {
        return Err(
            "Remote control requires an HTTP system proxy; HTTPS proxy endpoints are not supported"
                .to_string(),
        );
    }
    let stream = connect_http_proxy_tunnel(&target, &proxy_url)?;
    handshake(websocket_url, stream, target.scheme() == "wss")
}

fn handshake(
    url: &str,
    stream: TcpStream,
    secure: bool,
) -> Result<
    (
        WebSocket<MaybeTlsStream<TcpStream>>,
        tungstenite::handshake::client::Response,
    ),
    String,
> {
    stream
        .set_write_timeout(Some(CONNECT_TIMEOUT))
        .map_err(|error| format!("Could not configure WebSocket write timeout: {error}"))?;
    let result = if secure {
        client_tls(url, stream)
    } else {
        client(url, MaybeTlsStream::Plain(stream))
    };
    result.map_err(|error| format!("WebSocket handshake failed: {error}"))
}

fn direct_stream(target: &Url) -> Result<TcpStream, String> {
    let host = target
        .host_str()
        .ok_or("The WebSocket URL has no host")?
        .trim_matches(['[', ']']);
    let port = target
        .port_or_known_default()
        .ok_or("The WebSocket URL has no port")?;
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| error.to_string())?;
    let deadline = std::time::Instant::now() + CONNECT_TIMEOUT;
    for address in addresses {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        if let Ok(stream) =
            TcpStream::connect_timeout(&address, remaining.min(ADDRESS_ATTEMPT_TIMEOUT))
        {
            stream
                .set_read_timeout(Some(CONNECT_TIMEOUT))
                .map_err(|error| error.to_string())?;
            return Ok(stream);
        }
    }
    Err("Could not connect to the WebSocket server".into())
}

fn proxy_lookup_url(target: &Url) -> Result<Url, String> {
    let mut lookup = target.clone();
    let scheme = match target.scheme() {
        "ws" => "http",
        "wss" => "https",
        _ => return Err("Remote control URL must use ws:// or wss://".to_string()),
    };
    lookup
        .set_scheme(scheme)
        .map_err(|_| "Could not prepare the WebSocket proxy lookup URL".to_string())?;
    Ok(lookup)
}

fn connect_http_proxy_tunnel(target: &Url, proxy: &Url) -> Result<TcpStream, String> {
    let proxy_host = proxy
        .host_str()
        .ok_or_else(|| "The configured WebSocket proxy has no host".to_string())?;
    let proxy_port = proxy
        .port_or_known_default()
        .ok_or_else(|| "The configured WebSocket proxy has no port".to_string())?;
    let target_host = target
        .host_str()
        .ok_or_else(|| "The remote control URL has no host".to_string())?;
    let target_port = target
        .port_or_known_default()
        .ok_or_else(|| "The remote control URL has no port".to_string())?;
    let target_authority = format_authority(target_host, target_port);
    let proxy_address = (proxy_host, proxy_port)
        .to_socket_addrs()
        .map_err(|error| format!("Could not resolve the WebSocket proxy: {error}"))?
        .next()
        .ok_or_else(|| "Could not resolve the WebSocket proxy".to_string())?;
    let mut stream = TcpStream::connect_timeout(&proxy_address, CONNECT_TIMEOUT)
        .map_err(|error| format!("Could not connect to the WebSocket proxy: {error}"))?;
    stream
        .set_read_timeout(Some(CONNECT_TIMEOUT))
        .map_err(|error| format!("Could not configure the WebSocket proxy timeout: {error}"))?;
    stream
        .set_write_timeout(Some(CONNECT_TIMEOUT))
        .map_err(|error| {
            format!("Could not configure the WebSocket proxy write timeout: {error}")
        })?;
    let mut request = format!(
        "CONNECT {target_authority} HTTP/1.1\r\nHost: {target_authority}\r\nConnection: keep-alive\r\n"
    );
    if !proxy.username().is_empty() || proxy.password().is_some() {
        let username = percent_decode(proxy.username());
        let password = percent_decode(proxy.password().unwrap_or_default());
        let credentials =
            base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"));
        request.push_str(&format!("Proxy-Authorization: Basic {credentials}\r\n"));
    }
    request.push_str("\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Could not establish the WebSocket proxy tunnel: {error}"))?;
    let status = read_proxy_connect_status(&mut stream)?;
    if status != 200 {
        return Err(format!(
            "WebSocket proxy rejected CONNECT with HTTP {status}"
        ));
    }
    Ok(stream)
}

fn read_proxy_connect_status(stream: &mut TcpStream) -> Result<u16, String> {
    const MAX_PROXY_HEADER_BYTES: usize = 16 * 1024;
    let mut response = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    while response.len() < MAX_PROXY_HEADER_BYTES {
        let read = stream
            .read(&mut chunk)
            .map_err(|error| format!("Could not read the WebSocket proxy response: {error}"))?;
        if read == 0 {
            break;
        }
        response.extend_from_slice(&chunk[..read]);
        if response.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "The WebSocket proxy returned an incomplete CONNECT response".to_string())?;
    let status_header = String::from_utf8_lossy(&response[..header_end]);
    let status_line = status_header
        .lines()
        .next()
        .ok_or_else(|| "The WebSocket proxy returned an invalid CONNECT response".to_string())?;
    status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| "The WebSocket proxy returned an invalid HTTP status".to_string())
}

fn format_authority(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn percent_decode(value: &str) -> String {
    url::form_urlencoded::parse(value.as_bytes())
        .map(|(key, _)| key)
        .next()
        .map(|value| value.into_owned())
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn formats_websocket_proxy_authorities() {
        assert_eq!(format_authority("example.com", 443), "example.com:443");
        assert_eq!(format_authority("2001:db8::1", 443), "[2001:db8::1]:443");
    }

    #[test]
    fn maps_websocket_urls_to_http_proxy_lookup_urls() {
        let secure = proxy_lookup_url(&url::Url::parse("wss://example.com/socket").unwrap())
            .expect("secure websocket URL should map");
        assert_eq!(secure.as_str(), "https://example.com/socket");

        let plain = proxy_lookup_url(&url::Url::parse("ws://example.com/socket").unwrap())
            .expect("plain websocket URL should map");
        assert_eq!(plain.as_str(), "http://example.com/socket");
    }
}
