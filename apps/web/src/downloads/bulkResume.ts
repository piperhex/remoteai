import { BULK_LIMITS, BulkError, bulkAssert } from '../../../../shared/remote-chat/bulkLimits';
import { blockLength, checkpointBlocks, validateManifestPage } from '../../../../shared/remote-chat/downloadManifest';
import { readManifestPage } from './bulkStorage';
import { readStoredBlock } from './storage';
import { coalesceStoredRange, readStoredRange } from './chunkRanges';
import type { DownloadWorker } from './downloadWorker';
import type { DownloadTask } from './types';

export async function restoreBulkTask(options: {
  task: DownloadTask; worker: Pick<DownloadWorker, 'verify'>; signal: AbortSignal; importLegacy: boolean;
}) {
  const { task, worker, signal, importLegacy } = options;
  const manifest = task.manifest!;
  const candidates = importLegacy ? Array.from({ length: manifest.blockCount }, (_, block) => block)
    .filter(block => block * manifest.blockSize + blockLength(manifest, block) <= task.received)
    : checkpointBlocks(manifest, task.checkpoint, task.id);
  const committed: number[] = [];
  for (const block of candidates) {
    bulkAssert(!signal.aborted, 'CANCELLED');
    const offset = block * manifest.blockSize, length = blockLength(manifest, block);
    const blob = importLegacy ? await readStoredRange(task.id, offset, length) : await readStoredBlock(task.id, offset);
    if (!blob || blob.size !== length) continue;
    const index = Math.floor(block / BULK_LIMITS.hashesPerPage);
    const page = validateManifestPage(manifest, await readManifestPage(task.id, index), index);
    try { await worker.verify(new Uint8Array(await blob.arrayBuffer()), page.hashes[block % BULK_LIMITS.hashesPerPage]); }
    catch (error) {
      if (error instanceof BulkError && error.code === 'INTEGRITY_FAILED') continue;
      throw error;
    }
    bulkAssert(!signal.aborted, 'CANCELLED');
    if (importLegacy) await coalesceStoredRange(task.id, offset, blob);
    committed.push(block);
  }
  return { ...task, protocol: 'bulk' as const,
    received: committed.reduce((sum, block) => sum + blockLength(manifest, block), 0),
    checkpoint: { version: 1 as const, manifestId: manifest.manifestId, size: manifest.size,
      blockSize: manifest.blockSize, temporaryId: task.id, sequence: (task.checkpoint?.sequence ?? 0) + 1, committed } };
}
