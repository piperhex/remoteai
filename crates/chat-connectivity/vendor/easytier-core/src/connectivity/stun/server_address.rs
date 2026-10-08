//! Keep synthetic proxy destinations out of direct NAT discovery and port mapping.
use std::net::{IpAddr, Ipv4Addr};

const FAKE_IP_NETWORK: Ipv4Addr = Ipv4Addr::new(198, 18, 0, 0);
const FAKE_IP_MASK: u32 = 0xfffe_0000;

/// A STUN reply through a Fake-IP proxy describes that proxy's egress, not the peer's direct socket.
/// Filter before sampling DNS answers so a synthetic answer cannot hide a usable alternative.
pub(super) fn is_direct_stun_address(address: IpAddr) -> bool {
    match address.to_canonical() {
        IpAddr::V4(ip) => u32::from(ip) & FAKE_IP_MASK != u32::from(FAKE_IP_NETWORK),
        IpAddr::V6(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_the_complete_fake_ip_range_and_mapped_ipv6() {
        for address in [
            "198.18.0.0",
            "198.18.14.57",
            "198.19.255.255",
            "::ffff:198.18.14.57",
        ] {
            assert!(
                !is_direct_stun_address(address.parse().unwrap()),
                "{address}"
            );
        }
    }

    #[test]
    fn preserves_public_private_and_local_test_servers() {
        for address in [
            "198.17.255.255",
            "198.20.0.0",
            "192.0.2.1",
            "10.0.0.1",
            "127.0.0.1",
            "::1",
            "2001:db8::1",
            "::ffff:192.0.2.1",
        ] {
            assert!(
                is_direct_stun_address(address.parse().unwrap()),
                "{address}"
            );
        }
    }
}
