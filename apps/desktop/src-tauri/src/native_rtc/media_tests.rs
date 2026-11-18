use super::*;
use bytes::Bytes;
use webrtc::rtp::{
    codecs::{h264::H264Payloader, h265::HevcPayloader},
    header::Header,
    packet::Packet,
    packetizer::Payloader,
};

const CLOCK_RATE: u32 = 90_000;
const PAYLOAD_MTU: usize = 1188;
const LARGE_FRAME_BYTES: usize = 256 * 1024;

fn frame(hevc: bool, keyframe: bool, size: usize) -> Bytes {
    let mut bytes = vec![0, 0, 0, 1];
    if hevc {
        bytes.extend_from_slice(&[if keyframe { 19 << 1 } else { 1 << 1 }, 1]);
    } else {
        bytes.push(if keyframe { 0x65 } else { 0x41 });
    }
    bytes.resize(size, 0x55);
    bytes.into()
}

fn packets(hevc: bool, data: &Bytes, timestamp: u32, sequence: &mut u16) -> Vec<Packet> {
    let payloads = if hevc {
        HevcPayloader::default().payload(PAYLOAD_MTU, data).unwrap()
    } else {
        H264Payloader::default().payload(PAYLOAD_MTU, data).unwrap()
    };
    let count = payloads.len();
    payloads
        .into_iter()
        .enumerate()
        .map(|(index, payload)| {
            let packet = Packet {
                header: Header {
                    version: 2,
                    sequence_number: *sequence,
                    timestamp,
                    marker: index + 1 == count,
                    ..Default::default()
                },
                payload,
            };
            *sequence = sequence.wrapping_add(1);
            packet
        })
        .collect()
}

fn push<D: Depacketizer>(
    builder: &mut SampleBuilder<D>,
    packets: Vec<Packet>,
) -> Vec<webrtc::media::Sample> {
    let mut samples = Vec::new();
    for packet in packets {
        builder.push(packet);
        while let Some(sample) = builder.pop() {
            samples.push(sample);
        }
    }
    samples
}

fn large_keyframe<D: Depacketizer>(decoder: D, hevc: bool, reordered: bool) {
    let mut builder = sample_builder(decoder, CLOCK_RATE);
    // Cross sequence wrap as well as the old 64-packet ceiling.
    let mut sequence = u16::MAX - 10;
    let expected = frame(hevc, true, LARGE_FRAME_BYTES);
    let mut encoded = packets(hevc, &expected, 9000, &mut sequence);
    assert!(encoded.len() > 64);
    if reordered {
        for pair in encoded[1..].as_chunks_mut::<2>().0 {
            pair.swap(0, 1);
        }
    }
    let mut samples = push(&mut builder, encoded);
    samples.extend(push(
        &mut builder,
        packets(hevc, &frame(hevc, false, 32), 12000, &mut sequence),
    ));
    assert_eq!(
        samples.len(),
        1,
        "the first desktop keyframe must survive assembly"
    );
    assert_eq!(samples[0].data, expected);
    assert_eq!(samples[0].prev_dropped_packets, 0);
    assert!(is_keyframe(
        if hevc { "video/H265" } else { "video/H264" },
        &samples[0].data
    ));
}

#[test]
fn assembles_large_h264_desktop_keyframes() {
    large_keyframe(H264Packet::default(), false, false);
    large_keyframe(H264Packet::default(), false, true);
}

#[test]
fn assembles_large_hevc_desktop_keyframes() {
    large_keyframe(Hevc::default(), true, false);
    large_keyframe(Hevc::default(), true, true);
}

#[test]
fn incomplete_keyframe_expires_and_later_keyframe_recovers() {
    let mut builder = sample_builder(Hevc::default(), CLOCK_RATE);
    let mut sequence = 1;
    let mut damaged = packets(
        true,
        &frame(true, true, LARGE_FRAME_BYTES),
        9000,
        &mut sequence,
    );
    damaged.remove(10);
    assert!(push(&mut builder, damaged).is_empty());
    // A subsequent delta advances the RTP clock beyond the reorder deadline. Recovery must
    // discard the damaged frame, then accept the independently decodable replacement keyframe.
    assert!(push(
        &mut builder,
        packets(true, &frame(true, false, 32), 27000, &mut sequence),
    )
    .is_empty());
    let expected = frame(true, true, LARGE_FRAME_BYTES);
    let mut samples = push(&mut builder, packets(true, &expected, 30000, &mut sequence));
    samples.extend(push(
        &mut builder,
        packets(true, &frame(true, false, 32), 33000, &mut sequence),
    ));
    assert_eq!(samples.len(), 1);
    assert_eq!(samples[0].data, expected);
    assert!(samples[0].prev_dropped_packets > 0);
}
