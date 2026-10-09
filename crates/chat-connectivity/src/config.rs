use easytier::common::config::{ConfigLoader, NetworkIdentity, PeerConfig, TomlConfig};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{Error, Result};

pub(crate) const CHAT_PORT: u16 = 47777;
pub(crate) const HOST_NAME: &str = "csw-host";
pub(crate) const CLIENT_NAME: &str = "csw-client";

/// Created only from an authenticated chat grant, never an arbitrary frontend network config.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub session_id: String,
    pub secret: String,
    pub servers: Vec<String>,
    pub stun_servers: Vec<String>,
    pub desktop: bool,
    pub expires_at: u64,
}

impl Config {
    pub fn validate(&self) -> Result<()> {
        if self.session_id.is_empty()
            || self.session_id.len() > 128
            || !self
                .session_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
            || self.secret.len() != 64
            || !self.secret.bytes().all(|byte| byte.is_ascii_hexdigit())
            || self.servers.is_empty()
            || self.servers.len() > 4
            || self.stun_servers.len() > 8
            || self.expires_at <= crate::lease::now_ms()
        {
            return Err(Error::Invalid);
        }
        for server in &self.servers {
            validate_server(server)?;
        }
        for server in &self.stun_servers {
            validate_server(&format!("udp://{server}"))?;
        }
        Ok(())
    }

    pub(crate) fn core(&self) -> Result<TomlConfig> {
        self.validate()?;
        let config = TomlConfig::default();
        config.set_inst_name(format!("csw-{}", self.session_id));
        config.set_hostname(Some(
            if self.desktop { HOST_NAME } else { CLIENT_NAME }.into(),
        ));
        config.set_network_identity(NetworkIdentity::new(
            format!("csw-{}", self.session_id),
            self.secret.clone(),
        ));
        let address = if self.desktop {
            "10.253.0.1/24"
        } else {
            "10.253.0.2/24"
        };
        config.set_ipv4(Some(address.parse().map_err(|_| Error::Invalid)?));
        config.set_listeners(listeners()?);
        config.set_peers(
            self.servers
                .iter()
                .map(|value| {
                    Ok(PeerConfig {
                        uri: validate_server(value)?,
                        peer_public_key: None,
                    })
                })
                .collect::<Result<_>>()?,
        );
        config.set_stun_servers(Some(self.stun_servers.clone()));
        config.set_tcp_stun_servers(Some(self.stun_servers.clone()));
        config.set_stun_servers_v6(Some(self.stun_servers.clone()));
        configure_flags(&config);
        Ok(config)
    }

    pub(crate) fn remote_name(&self) -> &'static str {
        if self.desktop {
            CLIENT_NAME
        } else {
            HOST_NAME
        }
    }

    pub(crate) fn remote_address(&self) -> std::net::SocketAddr {
        let last = if self.desktop { 2 } else { 1 };
        std::net::SocketAddr::from(([10, 253, 0, last], CHAT_PORT))
    }
}

fn listeners() -> Result<Vec<Url>> {
    [
        "udp://0.0.0.0:0",
        "tcp://0.0.0.0:0",
        "udp://[::]:0",
        "tcp://[::]:0",
    ]
    .iter()
    .map(|value| value.parse().map_err(|_| Error::Invalid))
    .collect()
}

fn configure_flags(config: &TomlConfig) {
    let mut flags = config.get_flags();
    flags.no_tun = true;
    // No overlay routes are installed. Keep legacy global binding off; the per-instance
    // network plan selectively pins Windows IPv4 traversal while preserving loopback/IPv6.
    flags.bind_device = false;
    flags.use_smoltcp = true;
    flags.enable_encryption = true;
    flags.enable_ipv6 = true;
    flags.default_protocol = "udp".into();
    flags.disable_upnp = false;
    flags.disable_sym_hole_punching = false;
    flags.disable_relay_data = true;
    flags.relay_network_whitelist.clear();
    flags.accept_dns = false;
    flags.enable_exit_node = false;
    config.set_flags(flags);
}

fn validate_server(value: &str) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| Error::Invalid)?;
    if value.len() > 512
        || !matches!(url.scheme(), "udp" | "tcp")
        || url.host_str().is_none()
        || url.port().is_none_or(|port| port < 1024)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err(Error::Invalid);
    }
    Ok(url)
}
