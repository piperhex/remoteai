import { NativeRtcAudio } from './audio';
import type { BinaryHeader } from './types';
import { videoCodec } from './videoCodec';
import { hevcDimensions, type HevcDimensions } from './hevcDimensions';

type MediaHeader = Extract<BinaryHeader, { kind: 'media' }>;
const MAX_DECODE_QUEUE = 3;

/** Only compressed presentation frames cross IPC. No ICE, DTLS, SCTP or RTP runs in this view. */
export class NativeRtcMedia {
  readonly stream = new MediaStream();
  private readonly canvas = document.createElement('canvas');
  private readonly context = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
  private track?: CanvasCaptureMediaStreamTrack;
  private audio?: NativeRtcAudio;
  private decoder?: VideoDecoder;
  private codec = '';
  private dimensions?: HevcDimensions;
  private awaitingKeyframe = true;
  private frames = 0;
  private bytes = 0;
  private lastRequest = 0;
  private stopped = false;

  constructor(private readonly emit: (track: MediaStreamTrack) => void, private readonly requestKeyframe: () => void) {}

  receive(header: MediaHeader, data: Uint8Array) {
    if (this.stopped) return;
    if (header.codec.toLowerCase() === 'audio/opus') {
      if (!this.audio) {
        this.audio = new NativeRtcAudio(header.sampleRate, header.channels || 2);
        this.stream.addTrack(this.audio.track); this.emit(this.audio.track);
      }
      this.audio.receive(data, header.timestamp); return;
    }
    this.bytes += data.length;
    if (!this.decoder || this.decoder.state === 'closed' || this.decoder.decodeQueueSize > MAX_DECODE_QUEUE) this.reset();
    if (this.awaitingKeyframe && !header.keyframe) { this.request(); return; }
    if (header.keyframe) {
      const codec = videoCodec(header.codec, data);
      const dimensions = codec.startsWith('hev') ? hevcDimensions(data) ?? this.dimensions : undefined;
      if (codec !== this.codec || this.decoder?.state !== 'configured'
        || JSON.stringify(dimensions) !== JSON.stringify(this.dimensions)) this.configure(codec, dimensions);
      this.awaitingKeyframe = false;
    }
    this.decoder?.decode(new EncodedVideoChunk({ type: header.keyframe ? 'key' : 'delta',
      timestamp: header.timestamp, data }));
  }

  private configure(codec: string, dimensions?: HevcDimensions) {
    this.codec = codec;
    this.dimensions = dimensions;
    this.decoder ??= new VideoDecoder({ output: frame => this.render(frame), error: error => {
      console.error('Native RTC video decode failed', this.codec, error); this.reset();
    } });
    this.decoder.configure({ codec, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true,
      ...(dimensions ? { codedWidth: dimensions.codedWidth, codedHeight: dimensions.codedHeight } : {}) });
  }

  private render(frame: VideoFrame) {
    try {
      if (this.stopped || !this.context) return;
      // Some Windows HEVC decoders expose the padded coded frame instead of its SPS conformance window.
      const crop = this.dimensions && frame.displayWidth === this.dimensions.codedWidth
        && frame.displayHeight === this.dimensions.codedHeight ? this.dimensions.crop
        : { x: 0, y: 0, width: frame.displayWidth, height: frame.displayHeight };
      if (this.canvas.width !== crop.width) this.canvas.width = crop.width;
      if (this.canvas.height !== crop.height) this.canvas.height = crop.height;
      this.context.drawImage(frame, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      this.frames += 1;
      if (!this.track) {
        this.track = this.canvas.captureStream(0).getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
        this.stream.addTrack(this.track); this.emit(this.track);
      }
      this.track.requestFrame();
    } finally { frame.close(); }
  }

  private request() {
    if (performance.now() - this.lastRequest < 500) return;
    this.lastRequest = performance.now(); this.requestKeyframe();
  }

  private reset() {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = undefined; this.awaitingKeyframe = true; this.request();
  }

  stats() {
    return { id: 'native-video', type: 'inbound-rtp' as const, kind: 'video', timestamp: performance.now(),
      framesDecoded: this.frames, bytesReceived: this.bytes, frameWidth: this.frames ? this.canvas.width : 0,
      frameHeight: this.frames ? this.canvas.height : 0, codecId: 'native-video-codec' };
  }

  codecStats() {
    return { id: 'native-video-codec', type: 'codec' as const, timestamp: performance.now(),
      mimeType: !this.codec ? '' : this.codec.startsWith('hev') ? 'video/H265'
        : this.codec === 'vp8' ? 'video/VP8' : 'video/H264' };
  }

  close() {
    this.stopped = true;
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.audio?.close(); this.stream.getTracks().forEach(track => track.stop());
  }
}
