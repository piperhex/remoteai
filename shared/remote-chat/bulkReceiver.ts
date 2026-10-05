import { BulkAssembly } from './bulkAssembly';
import { BULK_LIMITS, BulkError, bulkAssert } from './bulkLimits';
import { blockLength, type DownloadManifest } from './downloadManifest';
import type { BulkClient, BulkOpened } from './bulkControl';
import type { BulkHeader } from './bulkProtocol';
import { bulkScheduler } from './bulkScheduler';
import type { DownloadMetrics } from './downloadMetrics';

interface Pending {
  assembly: BulkAssembly; resolve: (bytes: Uint8Array) => void; reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}
export interface BlockDecoder {
  decode: (record: Uint8Array) => Promise<{ header: BulkHeader; bytes: Uint8Array }>;
  verify: (bytes: Uint8Array, hash: string) => Promise<Uint8Array>;
}

/** Whole-block reservations bound assembly, ciphertext, worker copies and storage queues together. */
export class BulkReceiver {
  private readonly pending = new Map<string, Pending>();
  private readonly controller = new AbortController();
  private readonly unsubscribe: () => void;
  private readonly removeAbort: () => void;
  private incoming = Promise.resolve();
  private queuedBytes = 0;
  private granted = 0;
  private requestNumber = 0;
  private failure?: unknown;

  constructor(private readonly options: {
    client: BulkClient; opened: BulkOpened; signal: AbortSignal; decoder: BlockDecoder; metrics?: DownloadMetrics;
  }) {
    const transport = options.client.transport();
    bulkAssert(transport, 'PATH_UNAVAILABLE');
    this.unsubscribe = transport.listen(options.opened.transferId, {
      epoch: options.opened.epoch, path: options.opened.path, recordBytes: options.opened.capability.recordBytes,
      record: bytes => this.enqueue(bytes), failed: error => this.fail(error),
    });
    const abort = () => this.fail(new BulkError('CANCELLED'));
    options.signal.addEventListener('abort', abort, { once: true });
    this.removeAbort = () => options.signal.removeEventListener('abort', abort);
    if (options.signal.aborted) abort();
  }

  private enqueue(bytes: Uint8Array) {
    bulkAssert(this.queuedBytes + bytes.length <= BULK_LIMITS.peerRequestBytes + BULK_LIMITS.transportHighBytes,
      'RESOURCE_LIMIT');
    const length = bytes.length;
    this.options.metrics?.add('wireBytes', length);
    this.queuedBytes += length;
    this.incoming = this.incoming.then(async () => {
      if (this.failure) return;
      const { header, bytes: plain } = await this.options.decoder.decode(bytes);
      const pending = this.pending.get(header.requestId);
      bulkAssert(pending, 'INVALID_RECORD');
      const complete = pending.assembly.accept(header, plain);
      clearTimeout(pending.timer);
      if (complete) {
        this.pending.delete(header.requestId);
        // Only a fully authenticated block with a mismatched content hash is retryable.
        // Malformed records, AEAD failures and replay still terminate the epoch.
        try { pending.resolve(await this.options.decoder.verify(complete, pending.assembly.request.hash)); }
        catch (error) { pending.reject(error); }
      }
      else pending.timer = this.timeout(header.requestId);
    }).catch(error => this.fail(error)).finally(() => { this.queuedBytes -= length; });
  }

  private timeout(requestId: string) {
    return setTimeout(() => {
      if (this.pending.has(requestId)) this.fail(new BulkError('PATH_UNAVAILABLE'));
    }, BULK_LIMITS.stallMs);
  }

  async block(options: { block: number; hash: string; write: (bytes: Uint8Array) => Promise<void> }) {
    const { client, opened } = this.options;
    const manifest: DownloadManifest = opened.manifest;
    const length = blockLength(manifest, options.block);
    const waiting = performance.now();
    const release = await bulkScheduler.reserve({ peer: client.peer, transfer: opened.transferId,
      bytes: length, memory: length * 3 + BULK_LIMITS.recordBytes * 4, signal: this.controller.signal });
    this.options.metrics?.add('windowWaitMs', performance.now() - waiting);
    try {
      for (let attempt = 0; ; attempt += 1) {
        try { await this.requestBlock(options); return; }
        catch (error) {
          if (this.failure || !(error instanceof BulkError) || error.code !== 'INTEGRITY_FAILED'
            || attempt >= BULK_LIMITS.hashRetries) throw error;
        }
      }
    } catch (error) { this.fail(error); throw error; }
    finally { release(); }
  }

  private async requestBlock(options: { block: number; hash: string; write: (bytes: Uint8Array) => Promise<void> }) {
      const { client, opened } = this.options;
      const manifest = opened.manifest;
      const length = blockLength(manifest, options.block);
      if (this.failure) throw this.failure;
      const requestId = crypto.randomUUID();
      const result = new Promise<Uint8Array>((resolve, reject) => {
        this.pending.set(requestId, { resolve, reject, timer: this.timeout(requestId),
          assembly: new BulkAssembly({ requestId, block: options.block, length, hash: options.hash }, false) });
      });
      // Install a rejection observer before yielding to RPC, which may finish after a transport failure.
      const received = result.then(bytes => ({ bytes }), error => ({ error }));
      this.granted += length;
      bulkAssert(Number.isSafeInteger(this.granted), 'CREDIT_EXCEEDED');
      await client.request({ transferId: opened.transferId, epoch: opened.epoch,
        manifestId: manifest.manifestId, requestId, requestNumber: ++this.requestNumber,
        block: options.block, granted: this.granted });
      const outcome = await received;
      if ('error' in outcome) throw outcome.error;
      if (this.failure) throw this.failure;
      const storing = performance.now();
      await options.write(outcome.bytes);
      this.options.metrics?.add('storageMs', performance.now() - storing);
      this.options.metrics?.add('usefulBytes', length);
  }

  private fail(error: unknown) {
    this.failure ??= error; this.controller.abort();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(this.failure); }
    this.pending.clear();
  }
  async close() {
    this.fail(new BulkError('CANCELLED')); this.unsubscribe(); this.removeAbort();
    await this.incoming;
    await this.options.client.cancel(this.options.opened.transferId, this.options.opened.epoch)
      .catch(() => console.warn('Download transfer will expire with its connection.'));
  }
}
