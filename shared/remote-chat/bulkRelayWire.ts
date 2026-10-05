import { bulkAssert } from './bulkLimits';
import { decodeBulkRecord } from './bulkProtocol';

const MAGIC = [67, 83, 70, 49]; // CSF1, distinct from legacy hop-local CSB1 framing.
const HEADER = 5;
const MAX_SESSION = 128;
export function isBulkRelay(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  return MAGIC.every((value, index) => bytes[index] === value);
}
export function encodeBulkRelay(sessionId: string, record: Uint8Array) {
  bulkAssert(/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId), 'INVALID_RECORD');
  decodeBulkRecord(record);
  const bytes = new Uint8Array(HEADER + sessionId.length + record.length);
  bytes.set(MAGIC); bytes[4] = sessionId.length;
  for (let index = 0; index < sessionId.length; index += 1) bytes[HEADER + index] = sessionId.charCodeAt(index);
  bytes.set(record, HEADER + sessionId.length);
  return bytes;
}
export function decodeBulkRelay(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  const length = bytes[4];
  bulkAssert(isBulkRelay(data) && length > 0 && length <= MAX_SESSION, 'INVALID_RECORD');
  const sessionId = String.fromCharCode(...bytes.subarray(HEADER, HEADER + length));
  bulkAssert(/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId), 'INVALID_RECORD');
  const record = bytes.subarray(HEADER + length);
  decodeBulkRecord(record);
  return { sessionId, record };
}
