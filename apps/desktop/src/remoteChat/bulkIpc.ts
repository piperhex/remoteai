import { BULK_LIMITS, bulkAssert } from '../../../../shared/remote-chat/bulkLimits';
import { encodeBulkRelay } from '../../../../shared/remote-chat/bulkRelayWire';

const BATCH_HEADER_BYTES = 5;
const FRAME_LENGTH_BYTES = 4;

/** IPC-only batching; Rust still writes independent, unchanged CSF1 WebSocket records. */
export function encodeBulkIpc(sessionId: string, records: readonly Uint8Array[]) {
  bulkAssert(records.length > 0 && records.length <= BULK_LIMITS.sendBatchRecords, 'RESOURCE_LIMIT');
  const frames = records.map(record => encodeBulkRelay(sessionId, record));
  const size = frames.reduce((sum, frame) => sum + FRAME_LENGTH_BYTES + frame.length, BATCH_HEADER_BYTES);
  const bytes = new Uint8Array(size);
  bytes.set([67, 83, 70, 66, frames.length]); // CSFB
  const view = new DataView(bytes.buffer);
  let offset = BATCH_HEADER_BYTES;
  for (const frame of frames) {
    view.setUint32(offset, frame.length); offset += FRAME_LENGTH_BYTES;
    bytes.set(frame, offset); offset += frame.length;
  }
  return bytes;
}
