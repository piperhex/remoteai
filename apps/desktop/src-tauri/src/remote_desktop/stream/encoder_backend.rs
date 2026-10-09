use super::super::codec::{CaptureMethod, VideoCodec};

#[derive(Clone, Copy)]
pub(super) enum Backend {
    Dxgi,
    DirtyGpu,
    DirtyGdiHardware,
    DirtyGdi,
    Nvenc,
    MediaFoundation,
    Software,
    GdiSoftware,
}

impl Backend {
    pub fn helper(self) -> Option<&'static str> {
        match self {
            Self::Dxgi => Some("dxgi"),
            Self::DirtyGpu => Some("gpu"),
            Self::DirtyGdiHardware => Some("gdi-gpu"),
            Self::DirtyGdi => Some("gdi"),
            _ => None,
        }
    }
    pub fn framed(self) -> bool {
        self.helper().is_some()
    }
    pub fn hardware(self) -> bool {
        !matches!(self, Self::DirtyGdi | Self::Software | Self::GdiSoftware)
    }
    pub fn capture(self) -> CaptureMethod {
        match self {
            Self::Dxgi => CaptureMethod::Dxgi,
            Self::DirtyGdi | Self::DirtyGdiHardware | Self::GdiSoftware => CaptureMethod::Gdi,
            _ => CaptureMethod::Wgc,
        }
    }
    pub fn supports(self, codec: VideoCodec, worker: bool) -> bool {
        // The SYSTEM worker can duplicate the secure desktop. WGC remains a user-session fallback.
        let service_safe = matches!(self, Self::Dxgi | Self::DirtyGdiHardware | Self::DirtyGdi);
        let hevc = self.framed() && self.hardware();
        (!worker || service_safe) && (codec == VideoCodec::H264 || hevc)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn service_preserves_dxgi_and_gpu_encoding_with_a_compatible_software_fallback() {
        assert!(Backend::Dxgi.supports(VideoCodec::H265, true));
        assert!(Backend::DirtyGdiHardware.supports(VideoCodec::H265, true));
        assert!(Backend::DirtyGdi.supports(VideoCodec::H264, true));
        assert!(!Backend::DirtyGdi.supports(VideoCodec::H265, true));
        assert!(!Backend::DirtyGpu.supports(VideoCodec::H264, true));
        assert!(Backend::DirtyGpu.supports(VideoCodec::H265, false));
    }
}
