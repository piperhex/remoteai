import type { BinaryHeader } from './types';

/** Bounded binary IPC batches preserve SCTP record boundaries and media frame ordering. */
export function readNativePackets(batch: ArrayBuffer, receive: (header: BinaryHeader, bytes: Uint8Array) => void) {
  const view = new DataView(batch);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset < batch.byteLength) {
    if (offset + 8 > batch.byteLength) throw new Error('Truncated native RTC packet');
    const headerBytes = view.getUint32(offset);
    const payloadBytes = view.getUint32(offset + 4);
    offset += 8;
    if (!headerBytes || offset + headerBytes + payloadBytes > batch.byteLength) {
      throw new Error('Invalid native RTC packet length');
    }
    const header = JSON.parse(decoder.decode(new Uint8Array(batch, offset, headerBytes))) as BinaryHeader;
    offset += headerBytes;
    receive(header, new Uint8Array(batch, offset, payloadBytes));
    offset += payloadBytes;
  }
}
