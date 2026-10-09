//! Windows underlay selection is restricted to the app's native traversal sockets.
use std::{net::Ipv4Addr, ptr};

use netdev::Interface as NetworkInterface;
use network_interface::NetworkInterfaceConfig as _;
use windows_sys::Win32::{
    NetworkManagement::IpHelper::{
        FreeMibTable, GetIpForwardTable2, GetIpInterfaceEntry, MIB_IPFORWARD_TABLE2,
        MIB_IPINTERFACE_ROW,
    },
    Networking::WinSock::AF_INET,
};

use crate::{Error, Result};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Interface {
    pub name: String,
    pub index: u32,
    pub ipv4: Ipv4Addr,
    pub dns: Vec<Ipv4Addr>,
}

#[derive(Clone, Copy)]
struct DefaultRoute {
    index: u32,
    metric: u64,
}

pub(super) async fn detect() -> Result<Option<Interface>> {
    tokio::task::spawn_blocking(|| {
        if !active_synthetic_adapter()? {
            return Ok(None);
        }
        Ok(select(&netdev::get_interfaces(), &default_routes()?))
    })
    .await
    .map_err(|_| Error::Unavailable)?
}

fn active_synthetic_adapter() -> Result<bool> {
    // netdev filters unknown IfType values, including Wintun's IF_TYPE_PROP_VIRTUAL (53).
    // Enumerate addresses independently so detecting the tunnel does not require a known adapter type.
    let interfaces = network_interface::NetworkInterface::show().map_err(|_| Error::Unavailable)?;
    Ok(interfaces.iter().any(|interface| {
        interface
            .addr
            .iter()
            .any(|address| matches!(address.ip(), std::net::IpAddr::V4(ip) if synthetic(ip)))
            && connected_metric(interface.index).is_some()
    }))
}

fn synthetic(address: Ipv4Addr) -> bool {
    u32::from(address) & 0xfffe_0000 == u32::from(Ipv4Addr::new(198, 18, 0, 0))
}

pub(super) fn usable(address: Ipv4Addr) -> bool {
    !synthetic(address)
        && !address.is_loopback()
        && !address.is_link_local()
        && !address.is_unspecified()
        && !address.is_multicast()
        && !address.is_broadcast()
}

fn select(interfaces: &[NetworkInterface], routes: &[DefaultRoute]) -> Option<Interface> {
    routes
        .iter()
        .filter_map(|route| {
            let interface = interfaces.iter().find(|interface| {
                interface.index == route.index
                    && interface.is_up()
                    && !interface.is_loopback()
                    && !interface
                        .ipv4
                        .iter()
                        .any(|address| synthetic(address.addr()))
            })?;
            let ipv4 = interface
                .ipv4
                .iter()
                .map(|address| address.addr())
                .find(|address| usable(*address))?;
            let dns = interface
                .dns_servers
                .iter()
                .filter_map(|address| match address {
                    std::net::IpAddr::V4(address) if usable(*address) => Some(*address),
                    _ => None,
                })
                .collect();
            Some((
                route.metric,
                Interface {
                    // EasyTier's Windows runtime looks up network-interface FriendlyName, not AdapterName/GUID.
                    name: interface
                        .friendly_name
                        .clone()
                        .unwrap_or_else(|| interface.name.clone()),
                    index: interface.index,
                    ipv4,
                    dns,
                },
            ))
        })
        .min_by_key(|(metric, interface)| (*metric, interface.index))
        .map(|(_, interface)| interface)
}

struct RouteTable(*mut MIB_IPFORWARD_TABLE2);

impl Drop for RouteTable {
    fn drop(&mut self) {
        // SAFETY: GetIpForwardTable2 allocated this table; this owner frees it exactly once.
        unsafe {
            FreeMibTable(self.0.cast());
        }
    }
}

fn default_routes() -> Result<Vec<DefaultRoute>> {
    let mut table = ptr::null_mut();
    // SAFETY: table is a valid writable out pointer; the allocation is owned below on success.
    if unsafe { GetIpForwardTable2(AF_INET, &mut table) } != 0 || table.is_null() {
        return Err(Error::Unavailable);
    }
    let table = RouteTable(table);
    // SAFETY: the Windows-owned variable-length table contains NumEntries initialized rows.
    let rows = unsafe {
        std::slice::from_raw_parts((*table.0).Table.as_ptr(), (*table.0).NumEntries as usize)
    };
    let mut routes = Vec::new();
    for route in rows
        .iter()
        .filter(|route| route.DestinationPrefix.PrefixLength == 0)
    {
        let Some(metric) = connected_metric(route.InterfaceIndex) else {
            continue;
        };
        routes.push(DefaultRoute {
            index: route.InterfaceIndex,
            metric: u64::from(route.Metric) + metric,
        });
    }
    Ok(routes)
}

fn connected_metric(index: u32) -> Option<u64> {
    let mut interface = MIB_IPINTERFACE_ROW {
        Family: AF_INET,
        InterfaceIndex: index,
        ..Default::default()
    };
    // SAFETY: interface is an initialized in/out row with the required family and interface index.
    if unsafe { GetIpInterfaceEntry(&mut interface) } != 0 || !interface.Connected {
        return None;
    }
    Some(u64::from(interface.Metric))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interface(index: u32, ip: &str) -> NetworkInterface {
        let mut interface = NetworkInterface::dummy();
        interface.index = index;
        interface.name = format!("interface-{index}");
        interface.friendly_name = Some(format!("friendly-{index}"));
        interface.flags = 1;
        interface.ipv4 = vec![ip.parse().unwrap()];
        interface
    }

    #[test]
    fn selects_the_physical_default_route_by_combined_metric_not_interface_order() {
        let interfaces = vec![
            interface(1, "198.18.0.1/16"),
            interface(2, "10.2.51.197/24"),
            interface(3, "172.16.9.84/24"),
            interface(4, "169.254.1.1/16"),
        ];
        let routes = vec![
            DefaultRoute {
                index: 1,
                metric: 0,
            },
            DefaultRoute {
                index: 2,
                metric: 281,
            },
            DefaultRoute {
                index: 3,
                metric: 25,
            },
            DefaultRoute {
                index: 4,
                metric: 0,
            },
        ];
        assert_eq!(select(&interfaces, &routes).unwrap().index, 3);
        assert_eq!(select(&interfaces, &routes).unwrap().name, "friendly-3");
        assert!(select(&interfaces, &routes[..1]).is_none());
    }

    #[tokio::test]
    async fn native_pinned_wildcard_socket_receives_loopback_control() {
        use easytier::tunnel::common::{bind, BindDev};
        use tokio::net::UdpSocket;
        let interfaces = netdev::get_interfaces();
        let Some(interface) = select(&interfaces, &default_routes().unwrap()) else {
            // Offline test hosts have no usable physical default route.
            return;
        };
        let socket = bind::<UdpSocket>()
            .addr("0.0.0.0:0".parse().unwrap())
            .dev(BindDev::from(interface.name.as_str()))
            .call()
            .await
            .unwrap();
        let control = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        control
            .send_to(
                b"control",
                (Ipv4Addr::LOCALHOST, socket.local_addr().unwrap().port()),
            )
            .await
            .unwrap();
        let mut buffer = [0; 16];
        let (length, _) = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            socket.recv_from(&mut buffer),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(&buffer[..length], b"control");
        // Connect performs route selection without sending anything to the documentation address.
        socket.connect("192.0.2.1:3478").await.unwrap();
        assert_eq!(socket.local_addr().unwrap().ip(), interface.ipv4);
    }
}
