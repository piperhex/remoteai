import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { BULK_LIMITS, bulkAssert } from './bulkLimits';

const MAGIC = 0x52414231; // RAB1
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const BULK_HEADER_BYTES = 72;
export const BULK_TAG_BYTES = 16;
export const BULK_PAYLOAD_BYTES = BULK_LIMITS.recordBytes - BULK_HEADER_BYTES - BULK_TAG_BYTES;
export interface BulkHeader {
  transferId: string; epoch: string; requestId: string; block: number; offset: number;
  length: number; sequence: number;
}
export interface BulkCapability {
  version: 1; binary: true; recordBytes: number; blockBytes: number; receiveBytes: number;
  storage: 'idb-atomic' | 'synced-file';
}

export function negotiateBulk(local: BulkCapability, remote: BulkCapability): BulkCapability {
  for (const value of [local, remote]) {
    bulkAssert(value && value.version === 1 && value.binary === true
      && Number.isSafeInteger(value.recordBytes) && value.recordBytes > BULK_HEADER_BYTES + BULK_TAG_BYTES
      && value.recordBytes <= BULK_LIMITS.recordBytes && value.blockBytes === BULK_LIMITS.blockBytes
      && Number.isSafeInteger(value.receiveBytes) && value.receiveBytes >= value.blockBytes
      && value.receiveBytes <= BULK_LIMITS.maxPeerRequestBytes
      && ['idb-atomic', 'synced-file'].includes(value.storage), 'INVALID_RECORD');
  }
  return { ...local, recordBytes: Math.min(local.recordBytes, remote.recordBytes),
    receiveBytes: Math.min(local.receiveBytes, remote.receiveBytes) };
}

export function encodeBulkHeader(header: BulkHeader) {
  const bytes = new Uint8Array(BULK_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC); view.setUint8(4, 1); view.setUint8(5, 1);
  view.setUint16(6, BULK_HEADER_BYTES);
  for (const [index, value] of [header.transferId, header.epoch, header.requestId].entries()) {
    bulkAssert(typeof value === 'string' && UUID.test(value), 'INVALID_RECORD');
    bytes.set(hexToBytes(value.replace(/-/g, '')), 8 + index * 16);
  }
  const values = [header.block, header.offset, header.length, header.sequence];
  for (const [index, value] of values.entries()) {
    bulkAssert(Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff, 'INVALID_RECORD');
    view.setUint32(56 + index * 4, value);
  }
  bulkAssert(header.sequence > 0 && header.length > 0 && header.length <= BULK_PAYLOAD_BYTES
    && header.offset + header.length <= BULK_LIMITS.blockBytes, 'INVALID_RECORD');
  return bytes;
}

function readUuid(bytes: Uint8Array) {
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Validate the complete frame before allocating payload or assembly buffers. */
export function decodeBulkRecord(bytes: Uint8Array, limit = BULK_LIMITS.recordBytes) {
  bulkAssert(bytes.byteLength > BULK_HEADER_BYTES + BULK_TAG_BYTES && bytes.byteLength <= limit, 'INVALID_RECORD');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  bulkAssert(view.getUint32(0) === MAGIC && view.getUint8(4) === 1 && view.getUint8(5) === 1
    && view.getUint16(6) === BULK_HEADER_BYTES, 'INVALID_RECORD');
  const header: BulkHeader = {
    transferId: readUuid(bytes.subarray(8, 24)), epoch: readUuid(bytes.subarray(24, 40)),
    requestId: readUuid(bytes.subarray(40, 56)), block: view.getUint32(56), offset: view.getUint32(60),
    length: view.getUint32(64), sequence: view.getUint32(68),
  };
  encodeBulkHeader(header);
  bulkAssert(bytes.byteLength === BULK_HEADER_BYTES + header.length + BULK_TAG_BYTES, 'INVALID_RECORD');
  return { header, aad: bytes.subarray(0, BULK_HEADER_BYTES), encrypted: bytes.subarray(BULK_HEADER_BYTES) };
}
