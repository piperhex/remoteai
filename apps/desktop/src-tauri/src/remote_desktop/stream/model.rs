#[cfg(any(windows, target_os = "macos"))]
use super::super::{DesktopError, Result};
use serde::{Deserialize, Serialize};

/// Validated capture/encoder limits; no caller-supplied paths or process arguments cross IPC.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Profile {
    #[serde(default)]
    pub codec: super::codec::VideoCodec,
    #[serde(default)]
    pub adaptive_fps: bool,
    pub width: u32,
    pub fps: u32,
    pub bitrate: u32,
}

#[cfg(any(windows, target_os = "macos"))]
impl Profile {
    pub(super) fn validate(self) -> Result<Self> {
        super::super::validation::width(self.width)?;
        if !(1..=144).contains(&self.fps) || !(200_000..=32_000_000).contains(&self.bitrate) {
            return Err(DesktopError::Invalid);
        }
        Ok(self)
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IceServer {
    pub urls: Vec<String>,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub credential: String,
    #[serde(default)]
    pub native_media: bool,
    #[serde(default)]
    pub local_address: String,
    #[serde(default)]
    pub remote_address: String,
}

#[cfg(any(windows, target_os = "macos"))]
impl IceServer {
    pub(super) fn validate(&self) -> Result<()> {
        if self.urls.len() > 8 || self.username.len() > 512 || self.credential.len() > 512 {
            return Err(DesktopError::Invalid);
        }
        if self.native_media && !self.valid_native_media() {
            return Err(DesktopError::Invalid);
        }
        for value in &self.urls {
            if value.len() > 2048
                || !["stun:", "stuns:", "turn:", "turns:"]
                    .iter()
                    .any(|prefix| value.starts_with(prefix))
            {
                return Err(DesktopError::Invalid);
            }
        }
        Ok(())
    }

    fn valid_native_media(&self) -> bool {
        self.local_address == "10.253.0.1"
            && self.remote_address == "10.253.0.2"
            && self.username == "desktop-media"
            && self.credential.len() == 64
            && self.credential.bytes().all(|byte| byte.is_ascii_hexdigit())
            && (1..=2).contains(&self.urls.len())
            && self.urls.iter().all(|url| {
                url.strip_prefix("turn:127.0.0.1:")
                    .and_then(|value| {
                        value
                            .strip_suffix("?transport=udp")
                            .or_else(|| value.strip_suffix("?transport=tcp"))
                    })
                    .is_some_and(|port| port.parse::<u16>().is_ok_and(|port| port >= 1024))
            })
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenRequest {
    #[serde(default)]
    pub relay_standby: bool,
    #[serde(default)]
    pub clipboard_channel: bool,
    pub id: String,
    pub profile: Profile,
    pub ice_servers: Vec<IceServer>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SignalRequest {
    pub id: String,
    pub answer: Option<String>,
    pub candidates: Vec<serde_json::Value>,
    pub direct_upgrade: Option<DirectUpgrade>,
    pub relay_standby: Option<DirectUpgrade>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
pub(crate) struct DirectUpgrade {
    pub generation: u32,
    pub action: UpgradeAction,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum UpgradeAction {
    Start,
    Signal,
    Commit,
    Cancel,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Offer {
    pub sdp: String,
    #[serde(default)]
    pub direct_upgrade: bool,
    #[serde(default)]
    pub relay_standby: bool,
}

#[derive(Default, Deserialize, Serialize)]
pub(crate) struct SignalReply {
    pub candidates: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub committed: Option<bool>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub(crate) struct StreamStats {
    #[serde(default, flatten)]
    pub encoder: super::codec::EncoderInfo,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub bitrate: u32,
    pub closed: bool,
    pub connection: Option<Connection>,
    pub audio: Option<AudioState>,
    #[serde(default)]
    pub ice: IceDiagnostics,
}

/// Only bounded counters and fixed state names cross IPC; candidate addresses and SDP stay in WebRTC.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IceDiagnostics {
    pub state: String,
    pub local_candidates: usize,
    pub remote_candidates: usize,
    pub rejected_candidates: usize,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AudioState {
    Starting,
    Playing,
    Unavailable,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Connection {
    Direct,
    Relay,
}
