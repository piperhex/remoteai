//! Codec identity stays fixed across encoder restarts, direct upgrades and relay recovery.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum VideoCodec {
    #[default]
    H264,
    H265,
}

impl VideoCodec {
    #[cfg(windows)]
    pub(super) fn argument(self) -> &'static str {
        match self {
            Self::H264 => "h264",
            Self::H265 => "h265",
        }
    }
    pub(super) fn mime(self) -> &'static str {
        match self {
            Self::H264 => "video/H264",
            Self::H265 => "video/H265",
        }
    }
    pub(super) fn fmtp(self) -> &'static str {
        match self {
            Self::H264 => "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
            Self::H265 => "profile-id=1;tier-flag=0;level-id=153;tx-mode=SRST",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncoderInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_method: Option<CaptureMethod>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hardware_encoding: Option<bool>,
    pub video_codec: VideoCodec,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub(crate) enum CaptureMethod {
    #[serde(rename = "WGC")]
    Wgc,
    #[serde(rename = "DXGI")]
    Dxgi,
    #[serde(rename = "GDI")]
    Gdi,
}

impl EncoderInfo {
    pub(super) fn decode(bytes: &[u8]) -> super::super::Result<Self> {
        use super::super::DesktopError;
        let [capture, encoder, codec] = bytes else {
            return Err(DesktopError::Platform);
        };
        let capture_method = match capture {
            1 => CaptureMethod::Wgc,
            2 => CaptureMethod::Dxgi,
            3 => CaptureMethod::Gdi,
            _ => return Err(DesktopError::Platform),
        };
        let hardware_encoding = match encoder {
            1 | 2 => true,
            3 => false,
            _ => return Err(DesktopError::Platform),
        };
        let video_codec = match codec {
            1 => VideoCodec::H264,
            2 if hardware_encoding => VideoCodec::H265,
            _ => return Err(DesktopError::Platform),
        };
        Ok(Self {
            capture_method: Some(capture_method),
            hardware_encoding: Some(hardware_encoding),
            video_codec,
        })
    }
}

#[cfg(all(test, any(windows, target_os = "macos")))]
mod tests {
    use super::*;
    #[tokio::test]
    async fn offers_the_selected_codec_without_advertising_an_unencoded_alternative() {
        for codec in [VideoCodec::H264, VideoCodec::H265] {
            let peer = super::super::peer::create_codec(vec![], false, codec)
                .await
                .unwrap();
            let offer = peer.offer().await.unwrap();
            let expected = format!("{}/90000", codec.mime().trim_start_matches("video/"));
            assert!(offer.sdp.contains(&expected), "{expected}");
            let other = if codec == VideoCodec::H264 {
                "H265/90000"
            } else {
                "H264/90000"
            };
            assert!(!offer.sdp.contains(other));
            peer.close().await;
        }
    }
}
