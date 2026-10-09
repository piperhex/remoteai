use super::super::{DesktopError, Result};

const MAX_PACKET: usize = 8 * 1024 * 1024;

/// Cancellation-safe framing for the native helper. A final update never waits for the next frame.
#[derive(Default)]
pub(super) struct Packets {
    buffer: Vec<u8>,
    pub controllable: bool,
    pub info: Option<super::codec::EncoderInfo>,
}

impl Packets {
    pub fn push(&mut self, bytes: &[u8]) -> Result<()> {
        if self.buffer.len().saturating_add(bytes.len()) > MAX_PACKET + 4 + 32 * 1024 {
            return Err(DesktopError::Platform);
        }
        self.buffer.extend_from_slice(bytes);
        Ok(())
    }

    pub fn next(&mut self) -> Result<Option<Vec<u8>>> {
        let Some(header) = self.buffer.get(..4) else {
            return Ok(None);
        };
        let length = u32::from_le_bytes([header[0], header[1], header[2], header[3]]) as usize;
        if length == 0 || length > MAX_PACKET {
            return Err(DesktopError::Platform);
        }
        if self.buffer.len() < length + 4 {
            return Ok(None);
        }
        let packet = self.buffer[4..length + 4].to_vec();
        self.buffer.drain(..length + 4);
        if packet.starts_with(b"CSW3") {
            if self.controllable {
                return Err(DesktopError::Platform);
            }
            self.info = Some(super::codec::EncoderInfo::decode(&packet[4..])?);
            self.controllable = true;
            return self.next();
        }
        if packet == b"CSW2" {
            if self.controllable {
                return Err(DesktopError::Platform);
            }
            self.controllable = true;
            return self.next();
        }
        Ok(Some(packet))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_actual_capture_and_codec_without_forwarding_metadata_as_video() {
        let mut packets = Packets::default();
        packets
            .push(&[7, 0, 0, 0, b'C', b'S', b'W', b'3', 2, 1, 2, 1, 0, 0, 0, 9])
            .unwrap();
        assert_eq!(packets.next().unwrap().unwrap(), [9]);
        let info = packets.info.unwrap();
        assert!(matches!(
            info.capture_method,
            Some(super::super::codec::CaptureMethod::Dxgi)
        ));
        assert_eq!(info.hardware_encoding, Some(true));
        assert_eq!(info.video_codec, super::super::codec::VideoCodec::H265);
        assert!(packets.controllable);
        let mut invalid = Packets::default();
        invalid
            .push(&[7, 0, 0, 0, b'C', b'S', b'W', b'3', 2, 3, 2])
            .unwrap();
        assert!(invalid.next().is_err());
    }
    #[test]
    fn negotiates_live_control_without_delivering_capabilities_as_video() {
        let mut packets = Packets::default();
        packets.push(&[4, 0, 0, 0, b'C', b'S']).unwrap();
        assert!(packets.next().unwrap().is_none());
        assert!(!packets.controllable);
        packets.push(&[b'W', b'2', 1, 0, 0, 0, 9]).unwrap();
        assert_eq!(packets.next().unwrap().unwrap(), [9]);
        assert!(packets.controllable);
        packets.push(&[4, 0, 0, 0, b'C', b'S', b'W', b'2']).unwrap();
        assert!(packets.next().is_err());
    }

    #[test]
    fn split_reads_deliver_last_frame_without_a_following_frame() {
        let payload = [0, 0, 0, 1, 0x65, 7];
        let mut wire = (payload.len() as u32).to_le_bytes().to_vec();
        wire.extend(payload);
        let mut packets = Packets::default();
        for byte in &wire[..wire.len() - 1] {
            packets.push(&[*byte]).unwrap();
            assert!(packets.next().unwrap().is_none());
        }
        packets.push(&wire[wire.len() - 1..]).unwrap();
        assert_eq!(packets.next().unwrap().unwrap(), payload);
        assert!(packets.next().unwrap().is_none());
    }

    #[test]
    fn separates_coalesced_frames_and_rejects_invalid_lengths() {
        let mut packets = Packets::default();
        packets.push(&[1, 0, 0, 0, 9, 1, 0, 0, 0, 7]).unwrap();
        assert_eq!(packets.next().unwrap().unwrap(), [9]);
        assert_eq!(packets.next().unwrap().unwrap(), [7]);
        packets.push(&u32::MAX.to_le_bytes()).unwrap();
        assert!(packets.next().is_err());
        let mut empty = Packets::default();
        empty.push(&[0; 4]).unwrap();
        assert!(empty.next().is_err());
    }
}
