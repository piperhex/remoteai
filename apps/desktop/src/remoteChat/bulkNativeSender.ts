import { invoke } from '@tauri-apps/api/core';
import type { ChatLink } from '../../../../shared/remote-chat/link';
import type { BulkOpen } from '../../../../shared/remote-chat/bulkControl';
import { bulkAssert } from '../../../../shared/remote-chat/bulkLimits';
import { decodeNativeBulkBatch } from '../../../../shared/remote-chat/nativeBulkChannel';
import { fileDownloadByteLimit } from '../../../../shared/remote-chat/policy';

interface SourceOptions {
  open: BulkOpen; manifestId: string; recordBytes: number; link: ChatLink;
}
interface BatchRequest { block: number; offset: number; requestId: string }
interface NativeTarget { peer: string; channel: string }
interface NativeSent { usefulBytes: number; wireBytes: number }

/** Rust reads, verifies and encrypts each bounded batch; plaintext never crosses the WebView bridge. */
export class NativeBulkSender {
  private outgoing = Promise.resolve();
  private closed = false;
  private constructor(private readonly options: SourceOptions) {}

  static async open(options: SourceOptions) {
    const { open, manifestId, recordBytes, link } = options;
    const cipher = link.createBulkCipher({ transferId: open.transferId, epoch: open.epoch, manifestId });
    const material = cipher.takeSenderMaterial();
    const key = Array.from(material.key); material.key.fill(0);
    try {
      await invoke('codex_gui_file_bulk_sender_open', { request: {
        threadId: open.transferId, id: open.id, manifestId, epoch: open.epoch, key, recordBytes,
        maxBytes: fileDownloadByteLimit(link.connectionMode),
      } });
      return new NativeBulkSender(options);
    } finally { key.fill(0); }
  }

  send(request: BatchRequest, consume: (records: readonly Uint8Array[]) => Promise<void>) {
    const sent = this.outgoing.then(async () => {
      bulkAssert(!this.closed, 'CANCELLED');
      const { open, manifestId, link } = this.options;
      const bytes = await invoke<ArrayBuffer>('codex_gui_file_bulk_sender_read', { request: {
        source: { threadId: open.transferId, id: open.id, manifestId, block: request.block,
          maxBytes: fileDownloadByteLimit(link.connectionMode) },
        epoch: open.epoch, requestId: request.requestId, offset: request.offset,
      } });
      bulkAssert(!this.closed, 'CANCELLED');
      const records = decodeNativeBulkBatch(bytes);
      bulkAssert(records.length > 0, 'INVALID_RECORD');
      await consume(records);
    });
    // Keep allocation of native nonces and transmission in the same order across both active blocks.
    this.outgoing = sent.catch(() => { this.closed = true; });
    return sent;
  }

  sendDirect(request: BatchRequest, target: NativeTarget, beforeSend: () => void) {
    const sent = this.outgoing.then(async () => {
      bulkAssert(!this.closed, 'CANCELLED'); beforeSend();
      const { open, manifestId, link } = this.options;
      const result = await invoke<NativeSent>('codex_gui_file_bulk_sender_send', { request: { target, batch: {
        source: { threadId: open.transferId, id: open.id, manifestId, block: request.block,
          maxBytes: fileDownloadByteLimit(link.connectionMode) },
        epoch: open.epoch, requestId: request.requestId, offset: request.offset,
      } } });
      bulkAssert(!this.closed, 'CANCELLED');
      return result;
    });
    this.outgoing = sent.then(() => undefined).catch(() => { this.closed = true; });
    return sent;
  }

  destroy() { this.closed = true; }
}
