import type { ChannelBackend, ChannelSpec } from './types';
import { ChannelBackpressureError } from '../../../../shared/remote-chat/channelBackpressure';

const MAX_PENDING_BYTES = 512 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;
const encoder = new TextEncoder();

/** DOM-shaped control adapter. The data channel, SCTP queue and network socket live in Rust. */
export class NativeRtcChannel extends EventTarget {
  readonly label: string;
  readonly ordered = true;
  readonly protocol = '';
  readonly negotiated: boolean;
  readonly id: number | null;
  binaryType: BinaryType = 'arraybuffer';
  bufferedAmountLowThreshold = 64 * 1024;
  readyState: RTCDataChannelState = 'connecting';
  bufferedAmount = 0;
  private outgoing = Promise.resolve();

  constructor(readonly spec: ChannelSpec, private readonly backend: ChannelBackend) {
    super(); this.label = spec.label; this.negotiated = spec.negotiated != null; this.id = spec.negotiated ?? null;
  }

  get nativeRtcHandle() {
    return this.backend.id && this.readyState === 'open' ? { peer: this.backend.id, channel: this.spec.key } : undefined;
  }

  send(data: string | ArrayBuffer | ArrayBufferView) {
    if (this.readyState !== 'open') throw new DOMException('Data channel is closed', 'InvalidStateError');
    const text = typeof data === 'string';
    const bytes = typeof data === 'string' ? encoder.encode(data) : data instanceof ArrayBuffer
      ? new Uint8Array(data).slice() : new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    if (bytes.length > MAX_MESSAGE_BYTES) {
      throw new DOMException('Data channel capacity exceeded', 'OperationError');
    }
    if (this.bufferedAmount + bytes.length > MAX_PENDING_BYTES) throw new ChannelBackpressureError();
    this.bufferedAmount += bytes.length;
    this.outgoing = this.outgoing.then(async () => {
      if (this.readyState !== 'open') return;
      await this.backend.send(this.spec.key, bytes, text);
    }).catch(() => this.close()).finally(() => {
      this.bufferedAmount -= bytes.length;
      if (this.bufferedAmount <= this.bufferedAmountLowThreshold) this.dispatchEvent(new Event('bufferedamountlow'));
    });
  }

  opened() {
    if (this.readyState !== 'connecting') return;
    this.readyState = 'open'; this.dispatchEvent(new Event('open'));
  }

  receive(data: string | ArrayBuffer) {
    if (this.readyState === 'open') this.dispatchEvent(new MessageEvent('message', { data }));
  }

  closed() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed'; this.dispatchEvent(new Event('close'));
  }

  close() {
    if (this.readyState === 'closed') return;
    this.closed();
    void this.backend.perform({ kind: 'closeChannel', key: this.spec.key }).catch(() => {});
  }
}
