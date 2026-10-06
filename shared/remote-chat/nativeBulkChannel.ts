import { BULK_LIMITS, BulkError, bulkAssert } from './bulkLimits';
import { decodeBulkRecord } from './bulkProtocol';
import type { BinaryChannel } from './bulkTransport';

const BATCH_HEADER = 5;
const LENGTH_BYTES = 4;

/** One raw IPC operation per bounded batch. Native code writes unchanged encrypted records. */
export function encodeNativeBulkBatch(records: readonly Uint8Array[]) {
  bulkAssert(records.length > 0 && records.length <= BULK_LIMITS.sendBatchRecords, 'RESOURCE_LIMIT');
  for (const record of records) decodeBulkRecord(record);
  const size = records.reduce((sum, record) => sum + LENGTH_BYTES + record.length, BATCH_HEADER);
  const bytes = new Uint8Array(size);
  bytes.set([82, 65, 78, 49, records.length]); // RAN1
  const view = new DataView(bytes.buffer);
  let offset = BATCH_HEADER;
  for (const record of records) {
    view.setUint32(offset, record.length); offset += LENGTH_BYTES;
    bytes.set(record, offset); offset += record.length;
  }
  return bytes;
}

/** Receiving platforms route native bytes directly to their file writer, outside JavaScript. */
export class NativeBulkChannel implements BinaryChannel {
  private state = 'open';
  private pending = 0;
  private readonly closed = new Set<() => void>();
  private readonly low = new Set<() => void>();
  constructor(private readonly transmit?: (records: readonly Uint8Array[]) => Promise<void>) {}
  get readyState() { return this.state; }
  get bufferedAmount() { return this.pending; }
  onMessage() { /* Native file writers own the receive path. */ }
  onClose(callback: () => void) { this.closed.add(callback); }
  onLow(callback: () => void) { this.low.add(callback); return () => { this.low.delete(callback); }; }
  async sendBatch(records: readonly Uint8Array[]) {
    bulkAssert(this.state === 'open' && this.transmit, 'PATH_UNAVAILABLE');
    const length = records.reduce((sum, record) => sum + record.length, 0);
    bulkAssert(this.pending + length <= BULK_LIMITS.transportHighBytes, 'RESOURCE_LIMIT');
    this.pending += length;
    try { await this.transmit(records); }
    catch (error) { throw error instanceof BulkError ? error : new BulkError('PATH_UNAVAILABLE'); }
    finally {
      this.pending -= length;
      if (this.pending <= BULK_LIMITS.transportLowBytes) this.low.forEach(callback => callback());
    }
  }
  send(bytes: Uint8Array) { void this.sendBatch([bytes]).catch(() => this.close()); }
  close() {
    if (this.state === 'closed') return;
    this.state = 'closed'; this.closed.forEach(callback => callback());
    this.closed.clear(); this.low.clear();
  }
}
