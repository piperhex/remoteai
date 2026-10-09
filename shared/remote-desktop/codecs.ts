import type { DesktopVideoCodec } from './protocol';

interface DecodeSupport { supported: boolean; powerEfficient: boolean }
interface CodecEnvironment {
  codecs: () => readonly { mimeType: string }[];
  decode?: () => Promise<DecodeSupport>;
}
const PROBE_TIMEOUT_MS = 1500;

function environment(): CodecEnvironment {
  return {
    codecs: () => typeof RTCRtpReceiver === 'undefined' ? [] : RTCRtpReceiver.getCapabilities?.('video')?.codecs ?? [],
    decode: typeof navigator === 'undefined' || !navigator.mediaCapabilities?.decodingInfo ? undefined : () =>
      navigator.mediaCapabilities.decodingInfo({
        // Older TS DOM definitions omit the WebRTC extension supported by current Chromium.
        type: 'webrtc' as MediaDecodingType,
        video: { contentType: 'video/H265', width: 1920, height: 1080, bitrate: 6_000_000, framerate: 60 },
      }),
  };
}

/** Only advertise HEVC when this receiver reports both RTP support and power-efficient decoding. */
export async function desktopVideoCodecs(source: CodecEnvironment = environment()): Promise<DesktopVideoCodec[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!source.codecs().some(codec => codec.mimeType.toLowerCase() === 'video/h265') || !source.decode) {
      return ['h264'];
    }
    const support = await Promise.race([
      source.decode(), new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), PROBE_TIMEOUT_MS);
      }),
    ]);
    return support?.supported && support.powerEfficient ? ['h265', 'h264'] : ['h264'];
  } catch { return ['h264']; }
  finally { clearTimeout(timer); }
}
