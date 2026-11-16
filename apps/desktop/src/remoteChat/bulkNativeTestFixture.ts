// A wire-compatible stand-in for Rust IPC in orchestration tests, never imported by application code.
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { encodeBulkHeader } from '../../../../shared/remote-chat/bulkProtocol';
import { encodeNativeBulkBatch } from '../../../../shared/remote-chat/nativeBulkChannel';

interface NativeOpen {
  threadId: string; id: string; epoch: string; key: number[]; recordBytes: number;
}
interface NativeRead { source: { id: string; block: number }; epoch: string; requestId: string; offset: number }

export function nativeSenderFixture(content: (block: number) => Uint8Array) {
  const senders = new Map<string, NativeOpen & { sequence: number }>();
  return (command: string, data: unknown): ArrayBuffer | undefined => {
    if (command === 'codex_gui_file_bulk_sender_open') {
      const { request } = data as { request: NativeOpen };
      senders.set(request.id, { ...request, key: [...request.key], sequence: 0 });
      return;
    }
    if (command !== 'codex_gui_file_bulk_sender_read') return;
    const { request } = data as { request: NativeRead };
    const sender = senders.get(request.source.id)!;
    const bytes = content(request.source.block), payload = sender.recordBytes - 88;
    const records: Uint8Array[] = [];
    for (let offset = request.offset; offset < Math.min(bytes.length, request.offset + payload * 16); offset += payload) {
      const plain = bytes.subarray(offset, Math.min(bytes.length, offset + payload));
      const header = encodeBulkHeader({ transferId: sender.threadId, epoch: request.epoch,
        requestId: request.requestId, block: request.source.block, offset, length: plain.length,
        sequence: ++sender.sequence });
      const nonce = new Uint8Array(12); new DataView(nonce.buffer).setUint32(8, sender.sequence);
      const encrypted = chacha20poly1305(new Uint8Array(sender.key), nonce, header).encrypt(plain);
      const record = new Uint8Array(header.length + encrypted.length);
      record.set(header); record.set(encrypted, header.length); records.push(record);
    }
    return encodeNativeBulkBatch(records).buffer as ArrayBuffer;
  };
}
