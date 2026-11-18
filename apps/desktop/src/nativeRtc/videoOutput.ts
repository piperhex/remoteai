import type { HevcDimensions } from './hevcDimensions';

type Generator = MediaStreamTrack & { writable: WritableStream<VideoFrame> };
type GeneratorConstructor = new (options: { kind: 'video' }) => Generator;
type Crop = HevcDimensions['crop'];

export class NativeVideoOutput {
  width = 0;
  height = 0;
  private writer?: WritableStreamDefaultWriter<VideoFrame>;
  private generator?: Generator;
  private canvas?: HTMLCanvasElement;
  private context?: CanvasRenderingContext2D | null;
  private capture?: CanvasCaptureMediaStreamTrack;
  private busy = false;
  private stopped = false;

  constructor(private readonly stream: MediaStream, private readonly emit: (track: MediaStreamTrack) => void) {
    const Generate = (window as Window & { MediaStreamTrackGenerator?: GeneratorConstructor }).MediaStreamTrackGenerator;
    if (Generate) {
      try {
        this.generator = new Generate({ kind: 'video' });
        this.writer = this.generator.writable.getWriter();
      } catch { this.retireGenerator(); }
    }
  }

  render(frame: VideoFrame, dimensions?: HevcDimensions) {
    // Windows HEVC can return coded dimensions with padding outside the SPS conformance window.
    const crop = dimensions && frame.displayWidth === dimensions.codedWidth
      && frame.displayHeight === dimensions.codedHeight ? dimensions.crop : undefined;
    if (this.stopped || this.busy) { frame.close(); return; }
    if (this.writer && this.generator) {
      let output = frame;
      try {
        if (crop && (crop.width !== frame.displayWidth || crop.height !== frame.displayHeight)) {
          output = new VideoFrame(frame, { visibleRect: crop, displayWidth: crop.width, displayHeight: crop.height });
          frame.close();
        }
        void this.write(output, this.writer, this.generator);
        return;
      } catch { this.retireGenerator(); }
    }
    try { this.draw(frame, crop); } finally { frame.close(); }
  }

  private async write(frame: VideoFrame, writer: WritableStreamDefaultWriter<VideoFrame>, track: MediaStreamTrack) {
    // Transfer the decoder output directly and bound latency if the renderer falls behind.
    const { displayWidth, displayHeight } = frame;
    this.busy = true;
    try {
      await writer.write(frame);
      if (!this.stopped) this.presented(track, displayWidth, displayHeight);
    } catch { this.retireGenerator(); }
    finally { frame.close(); this.busy = false; }
  }

  private draw(frame: VideoFrame, crop?: Crop) {
    const { x, y, width, height } = crop ?? { x: 0, y: 0, width: frame.displayWidth, height: frame.displayHeight };
    this.canvas ??= document.createElement('canvas');
    this.context ??= this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!this.context) return;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.context.drawImage(frame, x, y, width, height, 0, 0, width, height);
    this.capture ??= this.canvas.captureStream(0).getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    this.presented(this.capture, width, height);
    this.capture.requestFrame();
  }

  private presented(track: MediaStreamTrack, width: number, height: number) {
    this.width = width; this.height = height;
    if (!this.stream.getTrackById(track.id)) { this.stream.addTrack(track); this.emit(track); }
  }

  private retireGenerator() {
    if (this.generator) {
      this.stream.removeTrack(this.generator); this.generator.stop(); this.generator = undefined;
    }
    if (this.writer) {
      const writer = this.writer; this.writer = undefined;
      void writer.abort().catch(() => { /* A failed write already closed the generator. */ })
        .finally(() => writer.releaseLock());
    }
  }

  close() { this.stopped = true; this.retireGenerator(); this.capture?.stop(); }
}
