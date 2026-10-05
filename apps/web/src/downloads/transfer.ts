import { DownloadCancelled, transferFileChunks, validateFileInfo }
  from '../../../../shared/remote-chat/fileDownload';
import type { DownloadClient } from '../../../../shared/remote-chat/downloads';
import { resetDownload, storeChunk } from './storage';
import type { DownloadTask } from './types';

interface Options {
  task: DownloadTask; client: DownloadClient; signal: AbortSignal; update: (task: DownloadTask) => void;
}
const checkCancelled = (signal: AbortSignal) => { if (signal.aborted) throw new DownloadCancelled(); };

/** Resume only when both size and revision match, so edits cannot mix old and new file contents. */
export async function transferDownload({ task, client, signal, update }: Options) {
  checkCancelled(signal);
  const { scope, threadId, cwd, path } = task.source;
  const info = await client.open({ scope, threadId, cwd, path, transferId: task.id });
  try {
    validateFileInfo(info);
    checkCancelled(signal);
    const resume = !!info.revision && info.revision === task.revision && info.size === task.size;
    task = { ...task, name: info.name, size: info.size, revision: info.revision, mimeType: info.mimeType,
      received: resume ? task.received : 0, status: 'downloading', message: '' };
    if (!resume) await resetDownload(task);
    update(task);
    const startedAt = performance.now();
    const startingOffset = task.received;
    await transferFileChunks({ client, threadId: task.id, info, signal, offset: task.received,
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
