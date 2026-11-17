//! Test-only camera/desktop replacement: encoded pattern frames and a tone, with no screen or microphone access.
use super::{model::*, peer::Peer};
use bytes::Bytes;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::Mutex;
use webrtc::{
    media::Sample,
    rtp_transceiver::rtp_codec::RTCRtpCodecCapability,
    track::track_local::{
        track_local_static_rtp::TrackLocalStaticRTP,
        track_local_static_sample::TrackLocalStaticSample, TrackLocal,
    },
};

#[path = "media_clock.rs"]
mod clock;

enum FixtureTrack {
    Sample(Arc<TrackLocalStaticSample>),
    Hevc(super::hevc_fixture::Fixture),
}

impl FixtureTrack {
    fn mime(&self) -> String {
        match self {
            Self::Sample(track) => track.codec().mime_type,
            Self::Hevc(_) => "video/H265".into(),
        }
    }

    async fn write(&self, sample: &Sample) -> webrtc::error::Result<()> {
        match self {
            Self::Sample(track) => track.write_sample(sample).await,
            Self::Hevc(track) => track.write(sample).await,
        }
    }
}

#[derive(Default)]
pub(super) struct Fixtures(Mutex<HashMap<String, Arc<Peer>>>);

async fn track(peer: &Peer, mime: &str, clock_rate: u32) -> FixtureTrack {
    let audio = mime == "audio/opus";
    let track = Arc::new(TrackLocalStaticSample::new(
        RTCRtpCodecCapability {
            mime_type: mime.into(),
            clock_rate,
            channels: if audio { 2 } else { 0 },
            sdp_fmtp_line: if audio {
                "minptime=10;useinbandfec=1"
            } else if mime == "video/H265" {
                "profile-id=1;tier-flag=0;level-id=153;tx-mode=SRST"
            } else {
                "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
            }
            .into(),
            ..Default::default()
        },
        if audio { "audio" } else { "video" }.into(),
        "fixture".into(),
    ));
    let (fixture, local): (FixtureTrack, Arc<dyn TrackLocal + Send + Sync>) =
        if mime == "video/H265" {
            let rtp = Arc::new(TrackLocalStaticRTP::new(
                track.codec(),
                "video".into(),
                "fixture".into(),
            ));
            (
                FixtureTrack::Hevc(super::hevc_fixture::Fixture::new(rtp.clone())),
                rtp,
            )
        } else {
            (FixtureTrack::Sample(track.clone()), track.clone())
        };
    let sender = peer.rtc.add_track(local).await.unwrap();
    // Advertise only the encoded fixture's codec, as the production desktop sender does.
    let mut codecs = sender.get_parameters().await.rtp_parameters.codecs;
    codecs.retain(|candidate| candidate.capability.mime_type.eq_ignore_ascii_case(mime));
    codecs.truncate(1);
    for candidate in &mut codecs {
        candidate.capability.sdp_fmtp_line = track.codec().sdp_fmtp_line;
    }
    for transceiver in peer.rtc.get_transceivers().await {
        if Arc::ptr_eq(&transceiver.sender().await, &sender) {
            transceiver
                .set_codec_preferences(codecs.clone())
                .await
                .unwrap();
        }
    }
    tokio::spawn(async move { while sender.read_rtcp().await.is_ok() {} });
    fixture
}

fn stream(peer: &Arc<Peer>, track: FixtureTrack, samples: Vec<Bytes>, duration: Duration) {
    let weak = Arc::downgrade(peer);
    // Windows' async timer granularity undersupplies a 144 FPS source. Pace the isolated fixture
    // on its own blocking worker, matching the production capture helper's independent clock.
    tokio::task::spawn_blocking(move || {
        let runtime = tokio::runtime::Handle::current();
        let mut clock = clock::FrameClock::new(duration);
        let mut index = 0;
        loop {
            clock.wait();
            let Some(peer) = weak.upgrade() else {
                return;
            };
            if peer.is_closed() {
                return;
            }
            if peer.rtc.connection_state().to_string() != "connected" {
                continue;
            }
            if runtime
                .block_on(track.write(&Sample {
                    data: samples[index % samples.len()].clone(),
                    duration,
                    ..Default::default()
                }))
                .is_err()
            {
                return;
            }
            index += 1;
            clock.sent(&track.mime());
        }
    });
}

fn load(codec: &str) -> (Vec<Bytes>, Vec<Bytes>) {
    let directory = std::path::PathBuf::from(std::env::var_os("NATIVE_RTC_FIXTURES").unwrap());
    let video = std::fs::read(directory.join(format!("pattern.{codec}"))).unwrap();
    let mut starts = Vec::new();
    for offset in 0..video.len().saturating_sub(5) {
        let length = if video[offset..].starts_with(&[0, 0, 0, 1]) {
            4
        } else if video[offset..].starts_with(&[0, 0, 1]) && (offset == 0 || video[offset - 1] != 0)
        {
            3
        } else {
            continue;
        };
        let nal = video[offset + length];
        if (codec == "h264" && nal & 31 == 9) || (codec == "h265" && (nal >> 1) & 63 == 35) {
            starts.push(offset);
        }
    }
    starts.push(video.len());
    let video: Vec<_> = starts
        .windows(2)
        .map(|range| Bytes::copy_from_slice(&video[range[0]..range[1]]))
        .collect();
    assert!(!video.is_empty());
    let packets = std::fs::read(directory.join("tone.opus-packets")).unwrap();
    let mut offset = 0;
    let mut audio = Vec::new();
    while offset < packets.len() {
        let length = u32::from_be_bytes(packets[offset..offset + 4].try_into().unwrap()) as usize;
        offset += 4;
        audio.push(Bytes::copy_from_slice(&packets[offset..offset + length]));
        offset += length;
    }
    (video, audio)
}

#[tauri::command]
pub(super) async fn native_rtc_fixture_open(
    state: tauri::State<'_, Fixtures>,
    codec: String,
) -> Result<Value> {
    if !matches!(codec.as_str(), "h264" | "h265") {
        return Err(Error::Invalid);
    }
    let peer = Peer::new(Configuration {
        ice_servers: Vec::new(),
        relay_only: false,
        receive_media: false,
    })
    .await?;
    let video = track(
        &peer,
        if codec == "h264" {
            "video/H264"
        } else {
            "video/H265"
        },
        90000,
    )
    .await;
    let audio = track(&peer, "audio/opus", 48000).await;
    let spec = ChannelSpec {
        key: uuid::Uuid::new_v4().to_string(),
        label: "remote-desktop-controls".into(),
        negotiated: None,
    };
    peer.create_channel(spec.clone()).await?;
    let id = uuid::Uuid::new_v4().to_string();
    state.0.lock().await.insert(id.clone(), peer.clone());
    let mut gathered = peer.rtc.gathering_complete_promise().await;
    peer.rtc
        .set_local_description(
            peer.rtc
                .create_offer(None)
                .await
                .map_err(|_| Error::Transport)?,
        )
        .await
        .map_err(|_| Error::Transport)?;
    tokio::time::timeout(Duration::from_secs(10), gathered.recv())
        .await
        .map_err(|_| Error::Transport)?;
    let samples = load(&codec);
    let fps = std::env::var("NATIVE_RTC_FIXTURE_FPS")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|fps| (1..=144).contains(fps))
        .unwrap_or(30);
    stream(
        &peer,
        video,
        samples.0,
        Duration::from_nanos(1_000_000_000 / u64::from(fps)),
    );
    stream(&peer, audio, samples.1, Duration::from_millis(20));
    reply(peer.clone(), spec.key);
    Ok(json!({"id":id,"sdp":peer.rtc.local_description().await.unwrap().sdp,"iceServers":[]}))
}

fn reply(peer: Arc<Peer>, key: String) {
    tokio::spawn(async move {
        while !peer.is_closed() {
            for event in peer.poll().await.unwrap_or_default() {
                if let Event::Text { text, .. } = event {
                    if text.contains("ping") {
                        if let Ok(channel) = peer.channel(&key).await {
                            if channel
                                .send(Bytes::from_static(b"{\"kind\":\"pong\"}"), true)
                                .await
                                .is_err()
                            {
                                return;
                            }
                        }
                    }
                }
            }
        }
    });
}

#[tauri::command]
pub(super) async fn native_rtc_fixture_signal(
    state: tauri::State<'_, Fixtures>,
    id: String,
    signal: Value,
) -> Result<Value> {
    let peer = state
        .0
        .lock()
        .await
        .get(&id)
        .cloned()
        .ok_or(Error::Closed)?;
    if let Some(sdp) = signal["answer"].as_str() {
        peer.operate(Operation::Remote {
            description: Description {
                r#type: "answer".into(),
                sdp: sdp.into(),
            },
        })
        .await?;
    }
    for candidate in signal["candidates"].as_array().into_iter().flatten() {
        peer.operate(Operation::Candidate {
            candidate: serde_json::from_value(candidate.clone()).map_err(|_| Error::Invalid)?,
        })
        .await?;
    }
    Ok(json!({"candidates":[]}))
}

#[tauri::command]
pub(super) async fn native_rtc_fixture_close(
    state: tauri::State<'_, Fixtures>,
    id: String,
) -> Result<()> {
    let peer = state.0.lock().await.remove(&id);
    if let Some(peer) = peer {
        peer.close().await;
    }
    Ok(())
}
