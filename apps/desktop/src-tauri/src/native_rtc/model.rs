use serde::{Deserialize, Serialize};
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;

pub(super) const MAX_PEERS: usize = 24;
pub(super) const MAX_CHANNELS: usize = 8;
pub(super) const MAX_MESSAGE_BYTES: usize = 64 * 1024;
pub(super) const HIGH_WATER_BYTES: usize = 256 * 1024;
pub(super) const LOW_WATER_BYTES: usize = 64 * 1024;
pub(super) const MAX_BINARY_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, thiserror::Error, Serialize)]
pub(crate) enum Error {
    #[error("invalid RTC request")]
    Invalid,
    #[error("RTC peer unavailable")]
    Closed,
    #[error("RTC capacity exceeded")]
    Capacity,
    #[error("RTC operation failed")]
    Transport,
}
pub(crate) type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Configuration {
    #[serde(default)]
    pub ice_servers: Vec<IceServer>,
    #[serde(default)]
    pub relay_only: bool,
    #[serde(default)]
    pub receive_media: bool,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IceServer {
    pub urls: Vec<String>,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub credential: String,
}

impl Configuration {
    pub(super) fn validate(&self) -> Result<()> {
        if self.ice_servers.len() > 32 {
            return Err(Error::Capacity);
        }
        for server in &self.ice_servers {
            if server.urls.is_empty()
                || server.urls.len() > 8
                || server.username.len() > 1024
                || server.credential.len() > 1024
                || server.urls.iter().any(|url| {
                    url.len() > 2048
                        || !["stun:", "stuns:", "turn:", "turns:"]
                            .iter()
                            .any(|scheme| url.starts_with(scheme))
                })
            {
                return Err(Error::Invalid);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Description {
    pub r#type: String,
    pub sdp: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ChannelSpec {
    pub key: String,
    pub label: String,
    pub negotiated: Option<u16>,
}

impl ChannelSpec {
    pub(super) fn validate(&self) -> Result<()> {
        uuid::Uuid::parse_str(&self.key).map_err(|_| Error::Invalid)?;
        if !matches!(
            self.label.as_str(),
            "codex-chat-v1"
                | "remote-ai-file-v1"
                | "remote-ai-sync-v1"
                | "remote-desktop-controls"
                | "remote-desktop-clipboard"
        ) || (self.negotiated.is_some()
            && !matches!(
                (self.negotiated, self.label.as_str()),
                (Some(42), "remote-ai-file-v1") | (Some(43), "remote-ai-sync-v1")
            ))
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Operation {
    Offer,
    Answer,
    Local { description: Description },
    Remote { description: Description },
    Candidate { candidate: RTCIceCandidateInit },
    CreateChannel { channel: ChannelSpec },
    CloseChannel { key: String },
    Stats,
    KeyFrame,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Event {
    Candidate {
        candidate: RTCIceCandidateInit,
    },
    State {
        state: String,
    },
    Gathering {
        state: String,
        description: Option<Description>,
    },
    Channel {
        channel: ChannelSpec,
    },
    Open {
        key: String,
    },
    Close {
        key: String,
    },
    Text {
        key: String,
        text: String,
    },
    BinaryReady,
    Closed,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum BinaryHeader {
    Data {
        key: String,
    },
    Media {
        track: String,
        codec: String,
        timestamp: u64,
        keyframe: bool,
        #[serde(rename = "sampleRate")]
        sample_rate: u32,
        channels: u16,
    },
}

pub(super) struct BinaryPacket {
    pub header: BinaryHeader,
    pub bytes: bytes::Bytes,
}
