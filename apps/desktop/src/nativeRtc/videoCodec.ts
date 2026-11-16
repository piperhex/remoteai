/** Recover decoder configuration from the authenticated RTP bitstream's parameter sets. */
export function videoCodec(mime: string, bytes: Uint8Array) {
  if (mime.toLowerCase() === 'video/vp8') return 'vp8';
  if (mime.toLowerCase() === 'video/h265') return 'hev1.1.6.L153.B0';
  for (let offset = 0; offset + 7 < bytes.length; offset += 1) {
    if (bytes[offset] !== 0 || bytes[offset + 1] !== 0 || bytes[offset + 2] !== 1
      || (bytes[offset + 3] & 31) !== 7) continue;
    return `avc1.${Array.from(bytes.slice(offset + 4, offset + 7), value => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return 'avc1.42e01f';
}

export async function nativeVideoCodecs(): Promise<('h264' | 'h265')[]> {
  if (typeof VideoDecoder === 'undefined') return [];
  const probe = async (codec: string) => (await VideoDecoder.isConfigSupported({
    codec, optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware',
  })).supported === true;
  if (!await probe('avc1.42e01f')) return [];
  try { if (await probe('hev1.1.6.L153.B0')) return ['h265', 'h264']; } catch { /* H.264 remains available. */ }
  return ['h264'];
}
