import { coalesceStoredRange, readStoredRange } from '../src/downloads/chunkRanges';
import { listDownloads, storeChunk, storeDownload } from '../src/downloads/storage';
import type { DownloadTask } from '../src/downloads/types';

const BLOCK_BYTES = 1024 * 1024;

export const resumeFixture = {
  saved: listDownloads,
  async seedLegacy(options: { size: number; received: number; chunkBytes: number; corruptBlock?: number }) {
    const task: DownloadTask = { id: crypto.randomUUID(), name: 'sample.bin', createdAt: Date.now(),
      source: { owner: 'owner', deviceId: 'computer', deviceName: '测试电脑', scope: 'project',
        threadId: 'thread', cwd: 'C:/project', path: 'C:/project/sample.bin' },
      size: options.size, received: 0, status: 'paused', protocol: 'legacy', revision: 'first',
      mimeType: 'application/octet-stream', message: '' };
    await storeDownload(task);
    for (let offset = 0; offset < options.received; offset += options.chunkBytes) {
      const length = Math.min(options.chunkBytes, options.received - offset);
      const corrupt = options.corruptBlock === undefined ? -1 : options.corruptBlock * BLOCK_BYTES + 7;
      let data = 'A'.repeat(length);
      if (corrupt >= offset && corrupt < offset + length) {
        const at = corrupt - offset;
        data = data.slice(0, at) + 'B' + data.slice(at + 1);
      }
      task.received = offset + length;
      await storeChunk(task, offset, btoa(data));
    }
  },
  async coalesceBeforeReload() {
    const [task] = await listDownloads();
    const blob = await readStoredRange(task.id, 0, BLOCK_BYTES);
    if (!blob) throw new Error('Fixture prefix missing');
    // Represents a tab closing between block migration and checkpoint publication.
    await coalesceStoredRange(task.id, 0, blob);
  },
};
