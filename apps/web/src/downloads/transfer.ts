import { DownloadCancelled, transferFileChunks, validateFileInfo }
  from '../../../../shared/remote-chat/fileDownload';
import type { DownloadClient } from '../../../../shared/remote-chat/downloads';
import { resetDownload, storeChunk } from './storage';
import type { DownloadTask } from './types';
import { transferBulkDownload } from './bulkTransfer';
import { BulkError } from '../../../../shared/remote-chat/bulkLimits';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';

interface Options {
  task: DownloadTask; client: DownloadClient; signal: AbortSignal; update: (task: DownloadTask) => void;
  mode?: () => ConnectionMode;
}
const checkCancelled = (signal: AbortSignal) => { if (signal.aborted) throw new DownloadCancelled(); };

/** Resume only when both size and revision match, so edits cannot mix old and new file contents. */
export async function transferDownload({ task, client, signal, update, mode }: Options) {
  checkCancelled(signal);
  const { scope, threadId, cwd, path, preview } = task.source;
  const info = await client.open({ scope, threadId, cwd, path, preview, transferId: task.id });
  try {
    validateFileInfo(info, mode?.());
    checkCancelled(signal);
    if (client.bulk?.available()) {
      await transferBulkDownload({ task: { ...task, name: info.name, size: info.size, mimeType: info.mimeType },
        info, client: client.bulk, signal, update, mode });
      return;
    }
    if (task.protocol === 'bulk' && task.received > 0) {
      // Keep authenticated blocks through temporary loss of the binary channel.
      throw new BulkError('PATH_UNAVAILABLE');
    }
    const resume = task.protocol !== 'bulk' && !!info.revision
      && info.revision === task.revision && info.size === task.size;
    task = { ...task, name: info.name, size: info.size, revision: info.revision, mimeType: info.mimeType,
      received: resume ? task.received : 0, status: 'downloading', protocol: 'legacy', message: '',
      manifest: undefined, checkpoint: undefined, verified: false };
    if (!resume) await resetDownload(task);
    update(task);
    const startedAt = performance.now();
    const startingOffset = task.received;
    await transferFileChunks({ client, threadId: task.id, info, signal, offset: task.received, mode,
      write: async (chunk, received) => {
        const next = { ...task, received,
          bytesPerSecond: (received - startingOffset) * 1000 / Math.max(1, performance.now() - startedAt) };
        await storeChunk(next, chunk.offset, chunk.data);
        task = next;
        update(task);
      } });
    checkCancelled(signal);
  } finally {
    if (typeof info?.id === 'string') await client.close(task.id, info.id)
      .catch(() => console.warn('Remote download handle will expire.'));
  }
}
