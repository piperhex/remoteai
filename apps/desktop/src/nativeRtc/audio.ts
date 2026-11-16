/** WebCodecs output is presentation only; RTP and Opus packet timing are supplied by Rust. */
interface AudioFrame {
  numberOfChannels: number; numberOfFrames: number; sampleRate: number;
  copyTo(destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }): void;
  close(): void;
}
interface Decoder {
  state: string; decodeQueueSize: number;
  configure(options: { codec: string; sampleRate: number; numberOfChannels: number }): void;
  decode(chunk: unknown): void; close(): void;
}
interface AudioCodecs {
  AudioDecoder?: new (options: { output: (frame: AudioFrame) => void; error: () => void }) => Decoder;
  EncodedAudioChunk?: new (options: { type: 'key'; timestamp: number; data: Uint8Array }) => unknown;
}

export class NativeRtcAudio {
  private readonly context = new AudioContext({ latencyHint: 'interactive' });
  private readonly output = this.context.createMediaStreamDestination();
  readonly track = this.output.stream.getAudioTracks()[0];
  private readonly decoder: Decoder;
  private next = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly resume = () => { void this.context.resume().catch(() => {}); };

  constructor(rate: number, channels: number) {
    const codecs = globalThis as unknown as AudioCodecs;
    if (!codecs.AudioDecoder || !codecs.EncodedAudioChunk) throw new Error('Audio decoder unavailable');
    this.decoder = new codecs.AudioDecoder({ output: frame => this.play(frame), error: () => this.close() });
    this.decoder.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: channels });
    window.addEventListener('pointerdown', this.resume); window.addEventListener('keydown', this.resume);
    this.resume();
  }

  receive(bytes: Uint8Array, timestamp: number) {
    const codecs = globalThis as unknown as AudioCodecs;
    if (this.decoder.state !== 'configured' || this.decoder.decodeQueueSize > 12) return;
    this.decoder.decode(new codecs.EncodedAudioChunk!({ type: 'key', timestamp, data: bytes }));
  }

  private play(frame: AudioFrame) {
    try {
      if (this.context.state !== 'running' || this.next - this.context.currentTime > 0.15) return;
      const buffer = this.context.createBuffer(frame.numberOfChannels, frame.numberOfFrames, frame.sampleRate);
      for (let channel = 0; channel < frame.numberOfChannels; channel += 1) {
        frame.copyTo(buffer.getChannelData(channel), { planeIndex: channel, format: 'f32-planar' });
      }
      const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.output);
      this.sources.add(source);
      source.onended = () => { source.disconnect(); this.sources.delete(source); };
      this.next = Math.max(this.context.currentTime + 0.01, this.next);
      source.start(this.next); this.next += buffer.duration;
    } finally { frame.close(); }
  }

  close() {
    window.removeEventListener('pointerdown', this.resume); window.removeEventListener('keydown', this.resume);
    if (this.decoder.state !== 'closed') this.decoder.close();
    for (const source of this.sources) { source.stop(); source.disconnect(); }
    this.sources.clear(); this.track.stop();
    if (this.context.state !== 'closed') void this.context.close().catch(() => {});
  }
}
