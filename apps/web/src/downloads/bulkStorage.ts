import { BULK_LIMITS, BulkError } from '../../../../shared/remote-chat/bulkLimits';
import { blockLength, type ManifestPage } from '../../../../shared/remote-chat/downloadManifest';
import { complete, openDownloadDatabase, result } from './storage';
import type { DownloadTask } from './types';
import { replaceChunkRanges, truncateChunks } from './chunkRanges';

export async function storeBulkCheckpoint(task: DownloadTask) {
  const db = await openDownloadDatabase();
  const transaction = db.transaction(['chunks', 'tasks'], 'readwrite');
  truncateChunks(transaction.objectStore('chunks'), task.id, task.size);
  transaction.objectStore('tasks').put(task);
  await complete(transaction);
}

export async function storeManifestPage(id: string, page: ManifestPage) {
  const db = await openDownloadDatabase();
  const transaction = db.transaction('manifests', 'readwrite');
  transaction.objectStore('manifests').put({ ...page, id });
  await complete(transaction);
}
export async function readManifestPage(id: string, page: number): Promise<ManifestPage> {
  const db = await openDownloadDatabase();
  return result(db.transaction('manifests').objectStore('manifests').get([id, page]));
}

interface BlockCommit {
  block: number; blob: Blob; resolve: () => void; reject: (error: unknown) => void;
}

/** Blocks and their committed bitmap share one transaction. No awaits keep an IDB transaction alive. */
export class BulkBlockStore {
  private pending: BlockCommit[] = [];
  private bytes = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private running = Promise.resolve();
  private failed?: unknown;
  constructor(private task: DownloadTask, private readonly update: (task: DownloadTask) => void) {}
  snapshot() { return this.task; }
  write(block: number, bytes: Uint8Array) {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ block, blob: new Blob([bytes]), resolve, reject });
      this.bytes += bytes.length;
      this.timer ??= setTimeout(() => this.flush(), BULK_LIMITS.commitMs);
      if (this.bytes >= BULK_LIMITS.commitBytes) this.flush();
    });
  }
  private flush() {
    clearTimeout(this.timer); this.timer = undefined;
    const batch = this.pending; this.pending = []; this.bytes = 0;
    if (!batch.length) return;
    this.running = this.running.then(() => this.commit(batch)).catch(error => {
      this.failed = error;
      batch.forEach(block => block.reject(error));
    });
  }
  private async commit(batch: BlockCommit[]) {
    if (this.failed) throw this.failed;
    const manifest = this.task.manifest;
    const checkpoint = this.task.checkpoint;
    if (!manifest || !checkpoint) throw new BulkError('INVALID_MANIFEST');
    const committed = [...new Set([...checkpoint.committed, ...batch.map(item => item.block)])].sort((a, b) => a - b);
    const next = { ...this.task, checkpoint: { ...checkpoint, committed, sequence: checkpoint.sequence + 1 },
      received: committed.reduce((sum, block) => sum + blockLength(manifest, block), 0) };
    const db = await openDownloadDatabase();
    const transaction = db.transaction(['chunks', 'tasks'], 'readwrite');
    replaceChunkRanges(transaction.objectStore('chunks'), this.task.id,
      batch.map(block => ({ offset: block.block * manifest.blockSize, blob: block.blob })));
    transaction.objectStore('tasks').put(next);
    await complete(transaction);
    this.task = next; this.update(next);
    batch.forEach(block => block.resolve());
  }
  async close() { this.flush(); await this.running; if (this.failed) throw this.failed; }
}
