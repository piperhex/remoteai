//! Instance-owned routing keeps discovery, mapped listeners and punch sockets on the same interface.
use std::net::SocketAddr;

use crate::socket::{IpVersion, tcp::TcpBindOptions, udp::UdpBindOptions};

fn unspecified_v4(address: Option<SocketAddr>, version: IpVersion) -> bool {
    version != IpVersion::V6
        && address.is_none_or(|address| address.is_ipv4() && address.ip().is_unspecified())
}

pub(super) fn tcp(options: &mut TcpBindOptions, interface: Option<&String>) {
    if options.need_protect
        && unspecified_v4(options.local_addr, options.context.ip_version)
        && let Some(interface) = interface
    {
        options.bind_device = Some(interface.clone());
    }
}

pub(super) fn udp(options: &mut UdpBindOptions, interface: Option<&String>) {
    if options.need_protect
        && unspecified_v4(options.local_addr, options.context.ip_version)
        && let Some(interface) = interface
    {
        // Keep ANY binding: the UDP listener must still receive local hole-punch control packets.
        options.bind_device = Some(interface.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_traversal_sockets_share_the_interface_without_narrowing_listener_bindings() {
        let interface = "physical".to_owned();
        for mut options in [
            UdpBindOptions::direct_connect(),
            UdpBindOptions::default(),
            UdpBindOptions::port_bound_listener("0.0.0.0:12345".parse().unwrap()),
        ] {
            let original = options.local_addr;
            udp(&mut options, Some(&interface));
            assert_eq!(options.bind_device.as_ref(), Some(&interface));
            assert_eq!(options.local_addr, original);
        }
        let mut options = TcpBindOptions::default();
        tcp(&mut options, Some(&interface));
        assert_eq!(options.bind_device.as_ref(), Some(&interface));
    }

    #[test]
    fn preserves_loopback_explicit_lan_ipv6_and_local_control_sockets() {
        let interface = "physical".to_owned();
        for address in ["127.0.0.1:1234", "192.168.1.2:1234", "[::]:1234"] {
            let mut options =
                UdpBindOptions::default().with_local_addr(Some(address.parse().unwrap()));
            let original = options.clone();
            udp(&mut options, Some(&interface));
            assert_eq!(options, original);
        }
        let mut options = UdpBindOptions::hole_punch_control().with_need_protect(false);
        let original = options.clone();
        udp(&mut options, Some(&interface));
        assert_eq!(options, original);
        let mut options = TcpBindOptions::default().with_need_protect(false);
        tcp(&mut options, Some(&interface));
        assert_eq!(options.bind_device, None);
    }
}
