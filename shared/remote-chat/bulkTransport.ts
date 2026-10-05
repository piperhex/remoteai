import { BULK_LIMITS, BulkError, bulkAssert } from './bulkLimits';
import { decodeBulkRecord } from './bulkProtocol';
import type { ConnectionMode } from './protocol';

export type BulkPath = 'direct' | 'relay';
export interface BinaryChannel {
  readonly maxRecordBytes?: number;
  readonly readyState: string; readonly bufferedAmount: number;
  send(bytes: Uint8Array): void; close(): void;
  onMessage(callback: (bytes: Uint8Array) => void): void;
  onLow(callback: () => void): () => void;
  onClose(callback: () => void): void;
}
interface Receiver {
  recordBytes?: number;
  epoch: string; path: BulkPath; record: (bytes: Uint8Array) => void; failed: (error: BulkError) => void;
}
export interface BulkRelay {
  available: () => boolean;
  send: (bytes: Uint8Array) => Promise<void>;
}

/** Bulk never enters LinkDelivery. A path change invalidates listeners instead of replaying old records. */
export class BulkTransport {
  private channel?: BinaryChannel;
  private mode: ConnectionMode = 'connecting';
  private readonly receivers = new Map<string, Receiver>();
  private readonly invalidated = new Set<() => void>();
  private outgoing = Promise.resolve();
  constructor(private readonly relay?: BulkRelay) {}

  get recordBytes() {
    const limit = this.mode === 'direct' ? this.channel?.maxRecordBytes : undefined;
    return limit && Number.isFinite(limit) ? Math.min(limit, BULK_LIMITS.recordBytes) : BULK_LIMITS.recordBytes;
  }

  get path(): BulkPath | undefined {
    if (this.mode === 'direct' && this.channel?.readyState === 'open') return 'direct';
    if (this.mode === 'relay' && this.relay?.available()) return 'relay';
    return undefined;
  }
  attach(channel: BinaryChannel) {
    this.invalidate(); this.channel?.close(); this.channel = channel;
    channel.onMessage(bytes => { if (this.channel === channel) this.receive(bytes, 'direct'); });
    channel.onClose(() => { if (this.channel === channel) this.invalidate(); });
  }
  setMode(mode: ConnectionMode) {
    if (this.mode !== mode) this.invalidate();
    this.mode = mode;
  }
  onInvalidated(callback: () => void) {
    this.invalidated.add(callback);
    return () => { this.invalidated.delete(callback); };
  }
  listen(transferId: string, receiver: Receiver) {
    bulkAssert(this.path === receiver.path && !this.receivers.has(transferId)
      && this.receivers.size < BULK_LIMITS.activeFiles, 'PATH_UNAVAILABLE');
    this.receivers.set(transferId, receiver);
    return () => { this.receivers.delete(transferId); };
  }
  receive(bytes: Uint8Array, path: BulkPath) {
    const { header } = decodeBulkRecord(bytes);
    const receiver = this.receivers.get(header.transferId);
    // Delayed packets from a fenced epoch are discarded before cipher or assembly allocation.
    if (!receiver || receiver.epoch !== header.epoch || receiver.path !== path || this.path !== path) return;
    try {
      bulkAssert(bytes.length <= (receiver.recordBytes ?? BULK_LIMITS.recordBytes), 'INVALID_RECORD');
      receiver.record(bytes);
    }
    catch (error) { receiver.failed(error instanceof BulkError ? error : new BulkError('INTEGRITY_FAILED')); }
  }

  failTransfer(transferId: string, epoch: string, error: BulkError) {
    const receiver = this.receivers.get(transferId);
    if (receiver?.epoch === epoch) receiver.failed(error);
  }

  send(bytes: Uint8Array, path: BulkPath, signal: AbortSignal) {
    const sent = this.outgoing.then(() => this.sendRecord(bytes, path, signal));
    // A failed epoch must not poison a newly negotiated transfer on the same connection.
    this.outgoing = sent.catch(() => undefined);
    return sent;
  }
  private async sendRecord(bytes: Uint8Array, path: BulkPath, signal: AbortSignal) {
    bulkAssert(!signal.aborted, 'CANCELLED');
    bulkAssert(this.path === path, 'PATH_UNAVAILABLE');
    decodeBulkRecord(bytes);
    if (path === 'relay') { await this.relay!.send(bytes); return; }
    const channel = this.channel!;
    if (channel.bufferedAmount + bytes.length > BULK_LIMITS.transportHighBytes) {
      await this.waitForCapacity(channel, signal);
    }
    bulkAssert(this.path === path && !signal.aborted, 'PATH_UNAVAILABLE');
    channel.send(bytes);
  }

  private waitForCapacity(channel: BinaryChannel, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: BulkError) => {
        unlisten(); removeInvalidation(); signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new BulkError('CANCELLED'));
      const unlisten = channel.onLow(() => finish());
      const removeInvalidation = this.onInvalidated(() => finish(new BulkError('PATH_UNAVAILABLE')));
      signal.addEventListener('abort', abort, { once: true });
      if (channel.bufferedAmount <= BULK_LIMITS.transportLowBytes) finish();
      else if (signal.aborted) abort();
    });
  }
  invalidate() {
    for (const receiver of this.receivers.values()) receiver.failed(new BulkError('PATH_UNAVAILABLE'));
    this.receivers.clear();
    for (const callback of [...this.invalidated]) callback();
  }
  close() { this.invalidate(); this.mode = 'offline'; this.channel?.close(); }
}
