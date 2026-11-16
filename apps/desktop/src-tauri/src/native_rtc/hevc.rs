//! RFC 7798 single-stream HEVC depacketization (sprop-max-don-diff=0, as negotiated by our sender).
use bytes::{Bytes, BytesMut};
use webrtc::rtp::{packetizer::Depacketizer, Error};

const START: &[u8] = &[0, 0, 0, 1];
const MAX_NAL_BYTES: usize = 4 * 1024 * 1024;

#[derive(Default)]
pub(super) struct Hevc {
    fragment: BytesMut,
}

impl Hevc {
    fn fragment(&mut self, bytes: &Bytes) -> Result<Bytes, Error> {
        if bytes.len() < 4 {
            return Err(Error::ErrShortPacket);
        }
        let header = bytes[2];
        if header & 0x80 != 0 {
            self.fragment.clear();
            self.fragment.extend_from_slice(START);
            self.fragment
                .extend_from_slice(&[(bytes[0] & 0x81) | ((header & 0x3f) << 1), bytes[1]]);
        } else if self.fragment.is_empty() {
            return Err(Error::ErrShortPacket);
        }
        if self.fragment.len() + bytes.len() - 3 > MAX_NAL_BYTES {
            self.fragment.clear();
            return Err(Error::ErrShortPacket);
        }
        self.fragment.extend_from_slice(&bytes[3..]);
        if header & 0x40 != 0 {
            Ok(self.fragment.split().freeze())
        } else {
            Ok(Bytes::new())
        }
    }

    fn aggregation(bytes: &Bytes) -> Result<Bytes, Error> {
        let mut offset = 2;
        let mut output = BytesMut::new();
        while offset < bytes.len() {
            let size = bytes.get(offset..offset + 2).ok_or(Error::ErrShortPacket)?;
            let size = u16::from_be_bytes([size[0], size[1]]) as usize;
            offset += 2;
            if size < 2 {
                return Err(Error::ErrShortPacket);
            }
            let nal = bytes
                .get(offset..offset + size)
                .ok_or(Error::ErrShortPacket)?;
            output.extend_from_slice(START);
            output.extend_from_slice(nal);
            offset += size;
        }
        Ok(output.freeze())
    }
}

impl Depacketizer for Hevc {
    fn depacketize(&mut self, bytes: &Bytes) -> Result<Bytes, Error> {
        if bytes.len() < 2 || bytes[0] & 0x80 != 0 || bytes[1] & 7 == 0 {
            return Err(Error::ErrShortPacket);
        }
        match (bytes[0] >> 1) & 0x3f {
            48 => Self::aggregation(bytes),
            49 => self.fragment(bytes),
            50..=63 => Err(Error::ErrShortPacket),
            _ => {
                let mut nal = BytesMut::with_capacity(4 + bytes.len());
                nal.extend_from_slice(START);
                nal.extend_from_slice(bytes);
                Ok(nal.freeze())
            }
        }
    }
    fn is_partition_head(&self, bytes: &Bytes) -> bool {
        bytes.len() >= 2
            && ((bytes[0] >> 1) & 0x3f != 49 || bytes.get(2).is_some_and(|value| value & 0x80 != 0))
    }
    fn is_partition_tail(&self, marker: bool, _: &Bytes) -> bool {
        marker
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reconstructs_fragmented_idr_and_aggregation_without_rtp_headers() {
        let mut decoder = Hevc::default();
        assert!(decoder
            .depacketize(&Bytes::from_static(&[0x62, 1, 0x93, 7, 8]))
            .unwrap()
            .is_empty());
        assert_eq!(
            decoder
                .depacketize(&Bytes::from_static(&[0x62, 1, 0x53, 9]))
                .unwrap(),
            [0, 0, 0, 1, 0x26, 1, 7, 8, 9].as_slice()
        );
        assert_eq!(
            decoder
                .depacketize(&Bytes::from_static(&[0x60, 1, 0, 3, 0x40, 1, 7]))
                .unwrap(),
            [0, 0, 0, 1, 0x40, 1, 7].as_slice()
        );
        assert!(decoder
            .depacketize(&Bytes::from_static(&[0x62, 1, 0x13, 7]))
            .is_err());
    }
}
