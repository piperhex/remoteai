//! RTP reordering, depacketization, loss recovery and RTCP remain outside the WebView.
use super::{hevc::Hevc, model::*, peer::Peer};
use std::{
    collections::HashSet,
    sync::{Arc, Weak},
    time::Duration,
};
use tokio::sync::Mutex;
use webrtc::{
    media::io::sample_builder::SampleBuilder,
    rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication,
    rtp::{
        codecs::{h264::H264Packet, opus::OpusPacket, vp8::Vp8Packet},
        packetizer::Depacketizer,
    },
    track::track_remote::TrackRemote,
};

#[cfg(test)]
#[path = "media_tests.rs"]
mod tests;

// This window includes the entire frame, not only out-of-order packets. At our 1200-byte RTP MTU,
// a 4 MiB desktop keyframe needs over 3500 packets; the former 64-packet window discarded its start.
const MAX_BUFFERED_PACKETS: u16 = 4096;
const MAX_REORDER_DELAY: Duration = Duration::from_millis(100);

fn sample_builder<D: Depacketizer>(decoder: D, clock_rate: u32) -> SampleBuilder<D> {
    SampleBuilder::new(MAX_BUFFERED_PACKETS, decoder, clock_rate)
        .with_max_time_delay(MAX_REORDER_DELAY)
}

#[derive(Default)]
pub(super) struct Media {
    tracks: Mutex<HashSet<u32>>,
    video: Mutex<HashSet<u32>>,
}

pub(super) fn bind(peer: &Arc<Peer>, enabled: bool) {
    let weak = Arc::downgrade(peer);
    peer.rtc.on_track(Box::new(move |track, _, _| {
        let weak = weak.clone();
        Box::pin(async move {
            let Some(peer) = weak.upgrade() else {
                return;
            };
            if !enabled {
                peer.stop();
                return;
            }
            let mut tracks = peer.media.tracks.lock().await;
            if tracks.len() >= 2 || !tracks.insert(track.ssrc()) {
                drop(tracks);
                peer.stop();
                return;
            }
            drop(tracks);
            let weak = Arc::downgrade(&peer);
            tauri::async_runtime::spawn(async move {
                if receive(weak.clone(), track).await.is_err() {
                    if let Some(peer) = weak.upgrade() {
                        peer.stop();
                    }
                }
            });
        })
    }));
}

impl Peer {
    pub(super) async fn request_keyframe(&self) -> Result<()> {
        let sources: Vec<_> = self.media.video.lock().await.iter().copied().collect();
        for media_ssrc in sources {
            self.rtc
                .write_rtcp(&[Box::new(PictureLossIndication {
                    sender_ssrc: 0,
                    media_ssrc,
                })])
                .await
                .map_err(|_| Error::Transport)?;
        }
        Ok(())
    }
}

async fn receive(peer: Weak<Peer>, track: Arc<TrackRemote>) -> Result<()> {
    let codec = track.codec().capability;
    #[cfg(test)]
    eprintln!("Native fixture track: {}", codec.mime_type);
    let name = codec.mime_type.to_ascii_lowercase();
    if name.starts_with("video/") {
        let current = peer.upgrade().ok_or(Error::Closed)?;
        current.media.video.lock().await.insert(track.ssrc());
        current.request_keyframe().await?;
    }
    match name.as_str() {
        "video/h264" => pump(peer, track, H264Packet::default()).await,
        "video/h265" => pump(peer, track, Hevc::default()).await,
        "video/vp8" => pump(peer, track, Vp8Packet::default()).await,
        "audio/opus" => pump(peer, track, OpusPacket).await,
        _ => Err(Error::Invalid),
    }
}

async fn pump<D: Depacketizer + Send + 'static>(
    peer: Weak<Peer>,
    track: Arc<TrackRemote>,
    decoder: D,
) -> Result<()> {
    let codec = track.codec().capability;
    let mut builder = sample_builder(decoder, codec.clock_rate);
    let mut origin = None;
    let mut frame = (0, 0usize);
    while let Ok((packet, _)) = track.read_rtp().await {
        let current = peer.upgrade().ok_or(Error::Closed)?;
        if current.is_closed() {
            break;
        }
        if packet.header.timestamp != frame.0 {
            frame = (packet.header.timestamp, 0);
        }
        frame.1 += packet.payload.len();
        if frame.1 > MAX_BINARY_BYTES {
            return Err(Error::Capacity);
        }
        builder.push(packet);
        while let Some(sample) = builder.pop() {
            let keyframe = is_keyframe(&codec.mime_type, &sample.data);
            #[cfg(test)]
            if origin.is_none() {
                eprintln!(
                    "Native fixture first sample: {} bytes={} key={keyframe}",
                    codec.mime_type,
                    sample.data.len()
                );
            }
            if sample.prev_dropped_packets > sample.prev_padding_packets {
                current.request_keyframe().await?;
            }
            let base = *origin.get_or_insert(sample.packet_timestamp);
            let timestamp = u64::from(sample.packet_timestamp.wrapping_sub(base)) * 1_000_000
                / u64::from(codec.clock_rate.max(1));
            current
                .push_binary(BinaryPacket {
                    header: BinaryHeader::Media {
                        track: track.id(),
                        codec: codec.mime_type.clone(),
                        timestamp,
                        keyframe,
                        sample_rate: codec.clock_rate,
                        channels: codec.channels,
                    },
                    bytes: sample.data,
                })
                .await;
        }
    }
    Ok(())
}

fn is_keyframe(codec: &str, bytes: &[u8]) -> bool {
    if codec.eq_ignore_ascii_case("audio/opus") {
        return true;
    }
    if codec.eq_ignore_ascii_case("video/vp8") {
        return bytes.first().is_some_and(|value| value & 1 == 0);
    }
    bytes.windows(4).any(|part| {
        if part[..3] != [0, 0, 1] {
            return false;
        }
        if codec.eq_ignore_ascii_case("video/h265") {
            matches!((part[3] >> 1) & 0x3f, 16..=21)
        } else {
            part[3] & 0x1f == 5
        }
    })
}
