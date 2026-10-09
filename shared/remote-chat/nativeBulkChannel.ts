import { BULK_LIMITS, BulkError, bulkAssert } from './bulkLimits';
import { decodeBulkRecord } from './bulkProtocol';
import type { BinaryChannel } from './bulkTransport';

const BATCH_HEADER = 5;
const LENGTH_BYTES = 4;
const BATCH_MAGIC = [82, 65, 78, 49]; // RAN1

/** Empty replies are idle polls; validate a complete native batch before delivering any record. */
export function decodeNativeBulkBatch(data: ArrayBuffer): Uint8Array[] {
  bulkAssert(data instanceof ArrayBuffer, 'INVALID_RECORD');
  if (!data.byteLength) return [];
  const maximum = BATCH_HEADER + BULK_LIMITS.sendBatchRecords * (LENGTH_BYTES + BULK_LIMITS.recordBytes);
  bulkAssert(data.byteLength >= BATCH_HEADER && data.byteLength <= maximum, 'INVALID_RECORD');
  const bytes = new Uint8Array(data), view = new DataView(data);
  bulkAssert(BATCH_MAGIC.every((value, index) => bytes[index] === value)
    && bytes[4] > 0 && bytes[4] <= BULK_LIMITS.sendBatchRecords, 'INVALID_RECORD');
  const records: Uint8Array[] = [];
  let offset = BATCH_HEADER;
  for (let index = 0; index < bytes[4]; index++) {
    bulkAssert(offset + LENGTH_BYTES <= bytes.length, 'INVALID_RECORD');
    const length = view.getUint32(offset); offset += LENGTH_BYTES;
    bulkAssert(length <= BULK_LIMITS.recordBytes && offset + length <= bytes.length, 'INVALID_RECORD');
    // Each worker decode transfers its buffer, so records must own separate buffers.
    const record = bytes.slice(offset, offset + length);
    decodeBulkRecord(record); records.push(record); offset += length;
  }
  bulkAssert(offset === bytes.length, 'INVALID_RECORD');
  return records;
}

/** One raw IPC operation per bounded batch. Native code writes unchanged encrypted records. */
export function encodeNativeBulkBatch(records: readonly Uint8Array[]) {
  bulkAssert(records.length > 0 && records.length <= BULK_LIMITS.sendBatchRecords, 'RESOURCE_LIMIT');
  for (const record of records) decodeBulkRecord(record);
  const size = records.reduce((sum, record) => sum + LENGTH_BYTES + record.length, BATCH_HEADER);
  const bytes = new Uint8Array(size);
  bytes.set([...BATCH_MAGIC, records.length]);
  const view = new DataView(bytes.buffer);
  let offset = BATCH_HEADER;
  for (const record of records) {
    view.setUint32(offset, record.length); offset += LENGTH_BYTES;
    bytes.set(record, offset); offset += record.length;
  }
  return bytes;
}

/** Mobile receives in its native writer; desktop forwards raw batches to the shared file receiver. */
export class NativeBulkChannel implements BinaryChannel {
  private state = 'open';
  private pending = 0;
  private readonly closed = new Set<() => void>();
  private readonly low = new Set<() => void>();
  private readonly messages = new Set<(bytes: Uint8Array) => void>();
  constructor(private readonly transmit?: (records: readonly Uint8Array[]) => Promise<void>) {}
  get readyState() { return this.state; }
  get bufferedAmount() { return this.pending; }
  onMessage(callback: (bytes: Uint8Array) => void) { this.messages.add(callback); }
  receive(bytes: Uint8Array) {
    if (this.state === 'open') this.messages.forEach(callback => callback(bytes));
  }
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
    this.closed.clear(); this.low.clear(); this.messages.clear();
  }
}
