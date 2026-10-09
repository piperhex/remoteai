import { BULK_LIMITS, bulkAssert } from '../../../../../../shared/remote-chat/bulkLimits';
import { decodeBulkRelay } from '../../../../../../shared/remote-chat/bulkRelayWire';

const HEADER_BYTES = 9;
const LENGTH_BYTES = 4;
const MAX_RELAY_BYTES = BULK_LIMITS.recordBytes + 5 + 128;
const MAGIC = [67, 71, 82, 49]; // CGR1: sequence, count, length-prefixed CSF1 records.

/** Validate the entire native batch before delivering any record to a file receiver. */
export function decodeGuiBulkBatch(data: ArrayBuffer) {
  bulkAssert(data instanceof ArrayBuffer && data.byteLength >= HEADER_BYTES
    && data.byteLength <= HEADER_BYTES + BULK_LIMITS.sendBatchRecords * (LENGTH_BYTES + MAX_RELAY_BYTES),
  'INVALID_RECORD');
  const bytes = new Uint8Array(data), view = new DataView(data);
  bulkAssert(MAGIC.every((value, index) => bytes[index] === value), 'INVALID_RECORD');
  const sequence = view.getUint32(4), count = bytes[8];
  bulkAssert(sequence > 0 && count > 0 && count <= BULK_LIMITS.sendBatchRecords, 'INVALID_RECORD');
  const records: ReturnType<typeof decodeBulkRelay>[] = [];
  let offset = HEADER_BYTES;
  for (let index = 0; index < count; index++) {
    bulkAssert(offset + LENGTH_BYTES <= bytes.length, 'INVALID_RECORD');
    const length = view.getUint32(offset); offset += LENGTH_BYTES;
    bulkAssert(length <= MAX_RELAY_BYTES && offset + length <= bytes.length, 'INVALID_RECORD');
    records.push(decodeBulkRelay(data.slice(offset, offset + length)));
    offset += length;
  }
  bulkAssert(offset === bytes.length, 'INVALID_RECORD');
  return { sequence, records };
}
