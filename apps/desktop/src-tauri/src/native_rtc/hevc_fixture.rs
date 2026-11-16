//! Test-only RFC 7798 packetizer. Upstream's sender omits IDR_N_LP and malformedly fragments CRA;
//! independent fixture packets let the production receiver cover both valid random-access types.
use bytes::{Bytes, BytesMut};
use std::sync::Arc;
use tokio::sync::Mutex;
use webrtc::{
    rtp::{header::Header, packet::Packet},
    track::track_local::{track_local_static_rtp::TrackLocalStaticRTP, TrackLocalWriter},
};

pub(super) struct Fixture {
    pub track: Arc<TrackLocalStaticRTP>,
    clock: Mutex<(u16, u32)>,
}

impl Fixture {
    pub fn new(track: Arc<TrackLocalStaticRTP>) -> Self {
        Self {
            track,
            clock: Mutex::new((0, 0)),
        }
    }

    pub async fn write(&self, bytes: &Bytes) -> webrtc::error::Result<()> {
        let payloads = payloads(bytes);
        let mut clock = self.clock.lock().await;
        for (index, payload) in payloads.iter().enumerate() {
            self.track
                .write_rtp(&Packet {
                    header: Header {
                        version: 2,
                        marker: index + 1 == payloads.len(),
                        sequence_number: clock.0,
                        timestamp: clock.1,
                        ..Default::default()
                    },
                    payload: payload.clone(),
                })
                .await?;
            clock.0 = clock.0.wrapping_add(1);
        }
        clock.1 = clock.1.wrapping_add(3000);
        Ok(())
    }
}

fn payloads(bytes: &Bytes) -> Vec<Bytes> {
    let mut starts = Vec::new();
    let mut offset = 0;
    while offset + 4 < bytes.len() {
        let length = if bytes[offset..].starts_with(&[0, 0, 0, 1]) {
            4
        } else if bytes[offset..].starts_with(&[0, 0, 1]) {
            3
        } else {
            offset += 1;
            continue;
        };
        starts.push((offset, offset + length));
        offset += length;
    }
    let mut result = Vec::new();
    for (index, (_, start)) in starts.iter().enumerate() {
        let end = starts.get(index + 1).map_or(bytes.len(), |item| item.0);
        let nal = bytes.slice(*start..end);
        if nal.len() <= 1188 {
            result.push(nal);
            continue;
        }
        let count = (nal.len() - 2).div_ceil(1185);
        for (part, fragment) in nal[2..].chunks(1185).enumerate() {
            let mut payload = BytesMut::new();
            payload.extend_from_slice(&[
                (nal[0] & 0x81) | (49 << 1),
                nal[1],
                ((nal[0] >> 1) & 63)
                    | if part == 0 { 0x80 } else { 0 }
                    | if part + 1 == count { 0x40 } else { 0 },
            ]);
            payload.extend_from_slice(fragment);
            result.push(payload.freeze());
        }
    }
    result
}
