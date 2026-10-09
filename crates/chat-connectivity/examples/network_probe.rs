//! Local/remote Windows network diagnostics. Never print the fixture grant.
#[cfg(windows)]
use csw_chat_connectivity::{Config, Error, Result};
#[cfg(windows)]
#[path = "../src/network/dns.rs"]
mod dns;
#[cfg(windows)]
#[path = "../src/network/windows.rs"]
mod windows;

#[cfg(windows)]
#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    use network_interface::NetworkInterfaceConfig as _;
    for interface in network_interface::NetworkInterface::show()? {
        println!(
            "all interface={} index={} addresses={:?}",
            interface.name, interface.index, interface.addr
        );
        let mut row = windows_sys::Win32::NetworkManagement::IpHelper::MIB_IPINTERFACE_ROW {
            Family: windows_sys::Win32::Networking::WinSock::AF_INET,
            InterfaceIndex: interface.index,
            ..Default::default()
        };
        // SAFETY: the initialized row has a valid family/index and remains writable during the call.
        let status = unsafe {
            windows_sys::Win32::NetworkManagement::IpHelper::GetIpInterfaceEntry(&mut row)
        };
        println!(
            "IP interface status={status} connected={} metric={}",
            row.Connected, row.Metric
        );
    }
    for interface in netdev::get_interfaces() {
        println!(
            "typed interface={:?} index={} up={} addresses={:?} dns={:?}",
            interface.friendly_name,
            interface.index,
            interface.is_up(),
            interface.ipv4,
            interface.dns_servers
        );
    }
    let selected = windows::detect().await?;
    println!("selected={selected:?}");
    if let Some(interface) = selected {
        let path = std::env::args().nth(1).ok_or("expected fixture path")?;
        let mut config: Config = serde_json::from_slice(&std::fs::read(path)?)?;
        dns::resolve_config(&mut config, &interface).await?;
        println!(
            "resolved stun={:?} coordinator={:?}",
            config.stun_servers, config.servers
        );
    }
    Ok(())
}

#[cfg(not(windows))]
fn main() {}
