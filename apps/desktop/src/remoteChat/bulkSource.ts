import { invoke } from '@tauri-apps/api/core';
import { guiApi } from '../pages/codexGui/api';
import { isDesktopApp } from '../api/backend';
import type { ChatLink } from '../../../../shared/remote-chat/link';
import { bulkCapability, BULK_ERROR_EVENT, type BulkOpen, type BulkOpened, type BulkRequest }
  from '../../../../shared/remote-chat/bulkControl';
import { BULK_LIMITS, bulkError, bulkAssert } from '../../../../shared/remote-chat/bulkLimits';
import { BulkCredit, bulkScheduler } from '../../../../shared/remote-chat/bulkScheduler';
import { BULK_HEADER_BYTES, BULK_TAG_BYTES, encodeBulkHeader, negotiateBulk }
  from '../../../../shared/remote-chat/bulkProtocol';
import { blockLength, type DownloadManifest } from '../../../../shared/remote-chat/downloadManifest';
import { fileDownloadByteLimit, getChatPolicy } from '../../../../shared/remote-chat/policy';
import { object, type RpcRequest, type RpcResponse } from '../../../../shared/remote-chat/protocol';
import { DownloadMetrics } from '../../../../shared/remote-chat/downloadMetrics';

interface Transfer {
  open: BulkOpen; manifest: DownloadManifest; cipher: ReturnType<ChatLink['createBulkCipher']>;
  credit: BulkCredit; controller: AbortController;
  requests: Map<string, { block: number; number: number }>; active: Map<number, string>;
  reserved: number; requestNumber: number; payloadBytes: number; attempts: Uint8Array; metrics: DownloadMetrics;
}

// Covers every authenticated peer, including scans and idle transfers. Metadata and source read
// copies therefore cannot multiply with connections outside the application's download budget.
const sourceSlots = new Set<string>();
const REQUEST_HISTORY = 128;
const MAX_TRANSFER_EPOCHS = 4096;
const IDLE_TRANSFER_MS = 5 * 60_000;

/** Only control messages use ChatOperations; file bytes travel through a separate bounded channel. */
export class BulkSource {
  private readonly transfers = new Map<string, Transfer>();
  private readonly preparing = new Map<string, { open: BulkOpen; controller: AbortController }>();
  private readonly slots = new Map<string, string>();
  private readonly opens = new Map<string, { signature: string; result: Promise<BulkOpened> }>();
  private readonly usedEpochs = new Set<string>();
  private readonly expiry = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly unsubscribe: () => void;
  constructor(private readonly link: ChatLink, private readonly peer: string) {
    this.unsubscribe = link.bulk?.onInvalidated(() => this.cancelAll()) ?? (() => undefined);
  }

  async execute(request: RpcRequest): Promise<RpcResponse> {
    try { return { kind: 'response', id: request.id, data: await this.control(object(request.body)) }; }
    catch (error) { return { kind: 'response', id: request.id,
      error: bulkError(error).code }; }
  }

  private async control(body: Record<string, unknown>): Promise<unknown> {
    if (body.action === 'capabilities') return { enabled: isDesktopApp && getChatPolicy().fileBulkEnabled === 1,
      path: this.link.bulk?.path, capability: bulkCapability('synced-file') };
    if (body.action === 'cancel') { this.cancel(String(body.transferId), String(body.epoch)); return; }
    bulkAssert(isDesktopApp && getChatPolicy().fileBulkEnabled === 1, 'PATH_UNAVAILABLE');
    if (body.action === 'open') return this.open(body as unknown as BulkOpen);
    const transfer = this.transfers.get(String(body.transferId));
    bulkAssert(transfer && !transfer.controller.signal.aborted, 'EPOCH_EXPIRED');
    this.expire(transfer.open, IDLE_TRANSFER_MS);
    if (body.action === 'page') {
      bulkAssert(Number.isSafeInteger(body.page), 'INVALID_MANIFEST');
      return this.manifest(transfer.open, Number(body.page));
    }
    bulkAssert(body.action === 'request', 'INVALID_RECORD');
    this.request(transfer, body as unknown as BulkRequest);
  }

  private manifest(open: BulkOpen, page?: number) {
    return guiApi.request<DownloadManifest>({ operation: 'fileManifest', threadId: open.transferId,
      id: open.id, page, maxBytes: fileDownloadByteLimit(this.link.connectionMode) });
  }

  private open(open: BulkOpen) {
    const signature = JSON.stringify(open);
    const previous = this.opens.get(open.transferId);
    if (previous) { bulkAssert(previous.signature === signature, 'INVALID_RECORD'); return previous.result; }
    const result = this.prepare(open);
    this.opens.set(open.transferId, { signature, result });
    void result.catch(() => { if (this.opens.get(open.transferId)?.result === result) this.opens.delete(open.transferId); });
    return result;
  }

  private async prepare(open: BulkOpen): Promise<BulkOpened> {
    encodeBulkHeader({ transferId: open.transferId, epoch: open.epoch, requestId: open.id,
      block: 0, offset: 0, length: 1, sequence: 1 });
    bulkAssert(this.link.bulk?.path === open.path && ['direct', 'relay'].includes(open.path), 'PATH_UNAVAILABLE');
    bulkAssert(!this.transfers.has(open.transferId) && !this.preparing.has(open.transferId)
      && this.transfers.size + this.preparing.size < BULK_LIMITS.activeFiles, 'RESOURCE_LIMIT');
    const capability = negotiateBulk(bulkCapability('synced-file', this.link.bulk.recordBytes), open.capability);
    bulkAssert(!this.usedEpochs.has(open.epoch), 'REPLAY');
    bulkAssert(this.usedEpochs.size < MAX_TRANSFER_EPOCHS, 'RESOURCE_LIMIT');
    bulkAssert(sourceSlots.size < BULK_LIMITS.activeFiles, 'RESOURCE_LIMIT');
    // Retain epochs for the authenticated link's lifetime so cancel/reopen cannot reset a used nonce space.
    this.usedEpochs.add(open.epoch);
    const slot = crypto.randomUUID(); sourceSlots.add(slot); this.slots.set(open.transferId, slot);
    // Install a reservation before awaiting the scan so concurrent OPENs cannot bypass the transfer cap.
    const controller = new AbortController();
    this.preparing.set(open.transferId, { open, controller });
    this.expire(open, BULK_LIMITS.prepareMs);
    const metrics = new DownloadMetrics();
    try {
      const manifest = await metrics.measure('prepareMs', () => this.manifest(open));
      bulkAssert(!controller.signal.aborted && this.link.bulk?.path === open.path, 'PATH_UNAVAILABLE');
      const cipher = this.link.createBulkCipher({ transferId: open.transferId, epoch: open.epoch,
        manifestId: manifest.manifestId });
      const transfer: Transfer = { open, manifest, cipher, controller, credit: new BulkCredit(open.epoch),
        requests: new Map(), active: new Map(), reserved: 0, requestNumber: 0,
        payloadBytes: capability.recordBytes - BULK_HEADER_BYTES - BULK_TAG_BYTES,
        attempts: new Uint8Array(manifest.blockCount), metrics };
      this.transfers.set(open.transferId, transfer);
      this.expire(open, IDLE_TRANSFER_MS);
      return { transferId: open.transferId, epoch: open.epoch, path: open.path, capability, manifest };
    } catch (error) { this.cancel(open.transferId, open.epoch); throw error; }
    finally {
      if (this.preparing.get(open.transferId)?.controller === controller) this.preparing.delete(open.transferId);
    }
  }

  private request(transfer: Transfer, request: BulkRequest) {
    encodeBulkHeader({ transferId: request.transferId, epoch: request.epoch, requestId: request.requestId,
      block: request.block, offset: 0, length: 1, sequence: 1 });
    bulkAssert(request.epoch === transfer.open.epoch && request.manifestId === transfer.manifest.manifestId,
      'EPOCH_EXPIRED');
    const length = blockLength(transfer.manifest, request.block);
    const previous = transfer.requests.get(request.requestId);
    if (previous !== undefined) {
      bulkAssert(previous.block === request.block && previous.number === request.requestNumber, 'INVALID_RECORD'); return;
    }
    bulkAssert(Number.isSafeInteger(request.requestNumber) && request.requestNumber > transfer.requestNumber,
      'REPLAY');
    bulkAssert(!transfer.active.has(request.block) && transfer.active.size < BULK_LIMITS.activeFiles, 'RESOURCE_LIMIT');
    bulkAssert(transfer.attempts[request.block] <= BULK_LIMITS.hashRetries, 'RESOURCE_LIMIT');
    transfer.credit.update(request.epoch, request.granted);
    bulkAssert(transfer.credit.available >= length + transfer.reserved, 'CREDIT_EXCEEDED');
    transfer.reserved += length;
    transfer.attempts[request.block] += 1;
    transfer.requestNumber = request.requestNumber;
    transfer.requests.set(request.requestId, { block: request.block, number: request.requestNumber });
    if (transfer.requests.size > REQUEST_HISTORY) transfer.requests.delete(transfer.requests.keys().next().value!);
    transfer.active.set(request.block, request.requestId);
    void this.send(transfer, request).catch(error => {
      const code = bulkError(error).code;
      this.cancel(request.transferId, request.epoch);
      void this.link.send({ kind: 'event', event: { method: BULK_ERROR_EVENT,
        params: { transferId: request.transferId, epoch: request.epoch, code } } })
        .catch(() => this.link.bulk?.invalidate());
    }).finally(() => {
      if (transfer.active.get(request.block) === request.requestId) transfer.active.delete(request.block);
    });
  }

  private async send(transfer: Transfer, request: BulkRequest) {
    const { signal } = transfer.controller;
    const length = blockLength(transfer.manifest, request.block);
    const release = await bulkScheduler.reserve({ peer: this.peer, transfer: request.transferId,
      bytes: length, memory: length * 2, signal });
    try {
      const bytes = new Uint8Array(await transfer.metrics.measure('verifyMs', () => invoke<ArrayBuffer>(
        'codex_gui_file_bulk_read', { request: {
        threadId: request.transferId, id: transfer.open.id, manifestId: request.manifestId, block: request.block,
        maxBytes: fileDownloadByteLimit(this.link.connectionMode),
      } })));
      bulkAssert(bytes.length === length, 'SOURCE_CHANGED');
      const batchBytes = transfer.payloadBytes * BULK_LIMITS.sendBatchRecords;
      for (let offset = 0; offset < bytes.length; offset += batchBytes) {
        bulkAssert(!signal.aborted, 'CANCELLED');
        const end = Math.min(offset + batchBytes, bytes.length);
        const records = this.encryptBatch(transfer, request, { bytes, offset, end });
        // A receiver may request a retry as soon as the last authenticated fragment arrives.
        if (end === bytes.length) transfer.active.delete(request.block);
        await transfer.metrics.measure('transportWaitMs', () =>
          this.link.bulk!.sendBatch(records, transfer.open.path, signal));
        transfer.metrics.add('usefulBytes', end - offset);
        transfer.metrics.add('wireBytes', records.reduce((sum, record) => sum + record.length, 0));
        // Yield once per bounded batch so RPC and the other file run without a timer per 16 KiB.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    } finally { release(); }
  }

  private encryptBatch(transfer: Transfer, request: BulkRequest,
    range: { bytes: Uint8Array; offset: number; end: number }) {
    const records: Uint8Array[] = [];
    for (let offset = range.offset; offset < range.end; offset += transfer.payloadBytes) {
      const fragment = range.bytes.subarray(offset, Math.min(offset + transfer.payloadBytes, range.end));
      transfer.credit.consume(fragment.length); transfer.reserved -= fragment.length;
      records.push(transfer.cipher.encrypt({ requestId: request.requestId, block: request.block, offset }, fragment));
    }
    return records;
  }

  private cancel(id: string, epoch: string) {
    const preparing = this.preparing.get(id);
    if (preparing?.open.epoch === epoch) {
      preparing.controller.abort(); this.preparing.delete(id); this.closeHandle(preparing.open);
      this.releaseSlot(id);
    }
    const transfer = this.transfers.get(id);
    if (!transfer || transfer.open.epoch !== epoch) return;
    transfer.controller.abort(); transfer.cipher?.destroy(); this.transfers.delete(id);
    transfer.metrics.record();
    this.releaseSlot(id);
    this.closeHandle(transfer.open);
  }
  private releaseSlot(id: string) {
    const slot = this.slots.get(id);
    if (slot) { sourceSlots.delete(slot); this.slots.delete(id); }
    clearTimeout(this.expiry.get(id)); this.expiry.delete(id); this.opens.delete(id);
  }
  private expire(open: BulkOpen, ms: number) {
    clearTimeout(this.expiry.get(open.transferId));
    this.expiry.set(open.transferId, setTimeout(() => this.cancel(open.transferId, open.epoch), ms));
  }
  private closeHandle(open: BulkOpen) {
    void guiApi.request({ operation: 'fileClose', threadId: open.transferId, id: open.id })
      .catch(() => console.warn('The remote file handle will expire automatically.'));
  }
  private cancelAll() {
    for (const preparing of this.preparing.values()) this.cancel(preparing.open.transferId, preparing.open.epoch);
    for (const transfer of this.transfers.values()) this.cancel(transfer.open.transferId, transfer.open.epoch);
  }
  close() { this.cancelAll(); this.unsubscribe(); }
}
