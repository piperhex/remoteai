//! Desktop capture and generic native RTC share the same validated TURN TCP/TLS bridge.
use super::{model::IceServer, DesktopError};
pub(super) use crate::native_rtc::turn_transport::Transports;
use webrtc::ice_transport::ice_server::RTCIceServer;

pub(super) async fn prepare(servers: &mut [IceServer]) -> super::super::Result<Transports> {
    let mut transport_servers: Vec<_> = servers
        .iter()
        .map(|server| RTCIceServer {
            urls: server.urls.clone(),
            username: server.username.clone(),
            credential: server.credential.clone(),
        })
        .collect();
    let transports = crate::native_rtc::turn_transport::prepare(&mut transport_servers)
        .await
        .map_err(|_| DesktopError::Platform)?;
    for (server, transport) in servers.iter_mut().zip(transport_servers) {
        server.urls = transport.urls;
    }
    Ok(transports)
}
