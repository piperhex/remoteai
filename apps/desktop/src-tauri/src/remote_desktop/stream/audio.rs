use super::super::{DesktopError, Result};
use std::sync::Arc;
const CLOCK_RATE: u32 = 48_000;
use webrtc::{
    api::media_engine::MIME_TYPE_OPUS,
    peer_connection::RTCPeerConnection,
    rtp_transceiver::rtp_codec::RTCRtpCodecCapability,
    track::track_local::{track_local_static_sample::TrackLocalStaticSample, TrackLocal},
};
#[cfg(windows)]
#[path = "audio_windows.rs"]
mod windows;
#[cfg(windows)]
pub(super) use windows::run;
pub(super) async fn track(connection: &RTCPeerConnection) -> Result<Arc<TrackLocalStaticSample>> {
    let track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: MIME_TYPE_OPUS.into(),
            clock_rate: CLOCK_RATE,
            channels: 2,
            sdp_fmtp_line: "minptime=10;useinbandfec=1;stereo=1".into(),
            ..Default::default()
        },
        "desktop-audio".into(),
        "desktop".into(),
    ));
    let sender = connection
        .add_track(Arc::clone(&track) as Arc<dyn TrackLocal + Send + Sync>)
        .await
        .map_err(|_| DesktopError::Platform)?;
    tokio::spawn(async move {
        // Reading feedback keeps the default RTCP interceptors running until the peer closes.
        while sender.read_rtcp().await.is_ok() {}
    });
    Ok(track)
}

#[cfg(target_os = "macos")]
pub(super) async fn run(stream: Arc<super::native::Stream>, _: std::path::PathBuf) {
    *stream.audio.lock().await = super::model::AudioState::Unavailable;
}
