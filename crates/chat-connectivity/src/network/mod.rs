//! Select an instance-owned underlay without modifying system routes or proxy configuration.
use easytier::common::config::TomlConfig;

use crate::{Config, Result};

#[cfg(windows)]
mod dns;
#[cfg(windows)]
mod windows;

#[derive(Default)]
pub(crate) struct Plan {
    #[cfg(windows)]
    selected: Option<windows::Interface>,
    #[cfg(windows)]
    watch: bool,
}

pub(crate) async fn prepare(config: &mut Config) -> Result<Plan> {
    #[cfg(windows)]
    {
        // Local coordinators and fixtures must retain loopback routing even with a VPN enabled.
        if config.servers.iter().any(|server| {
            url::Url::parse(server).ok().is_some_and(|url| {
                url.host_str() == Some("localhost")
                    || url.host_str().is_some_and(|host| {
                        host.trim_matches(['[', ']'])
                            .parse::<std::net::IpAddr>()
                            .is_ok_and(|address| address.is_loopback())
                    })
            })
        }) {
            return Ok(Plan::default());
        }
        let selected = windows::detect().await?;
        if let Some(interface) = &selected {
            dns::resolve_config(config, interface).await?;
        }
        Ok(Plan {
            selected,
            watch: true,
        })
    }
    #[cfg(not(windows))]
    {
        let _config = config;
        Ok(Plan::default())
    }
}

impl Plan {
    pub(crate) fn apply(&self, core: &TomlConfig) {
        #[cfg(windows)]
        core.set_outbound_interface(
            self.selected
                .as_ref()
                .map(|interface| interface.name.clone()),
        );
        #[cfg(not(windows))]
        let _core = core;
    }

    pub(crate) fn local_ipv4(&self) -> Option<std::net::Ipv4Addr> {
        #[cfg(windows)]
        {
            self.selected.as_ref().map(|interface| interface.ipv4)
        }
        #[cfg(not(windows))]
        {
            None
        }
    }

    pub(crate) async fn changed(&self) {
        #[cfg(windows)]
        if self.watch {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                if let Ok(selected) = windows::detect().await {
                    if selected != self.selected {
                        return;
                    }
                }
            }
        }
        std::future::pending::<()>().await;
    }
}
