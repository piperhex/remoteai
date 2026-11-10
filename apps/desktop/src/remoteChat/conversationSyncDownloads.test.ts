import { afterEach, expect, it, vi } from 'vitest';
import type { DownloadTask } from '../../../../shared/downloads/types';
import type { SyncBundle, SyncHost, SyncRequest } from '../../../../shared/conversation/sync/types';
import { enqueueSyncDownload, releaseSyncHosts } from '../../../../shared/conversation/sync/downloads';
import { downloadManager, WebDownloadManager } from '../../../../shared/downloads/manager';

vi.mock('antd-mobile', () => ({ Dialog: { confirm: vi.fn() } }));

const storage = vi.hoisted(() => new Map<string, DownloadTask>());
vi.mock('../../../../shared/downloads/storage', () => ({
  listDownloads: async () => [...storage.values()].map(task => structuredClone(task)),
  storeDownload: async (task: DownloadTask) => { storage.set(task.id, structuredClone(task)); },
  deleteDownload: async (id: string) => { storage.delete(id); },
}));

const CHUNK = 256 * 1024;
const owner = 'sync-test';
function fixture(options: { hold?: boolean; lostAck?: boolean; badHash?: boolean } = {}) {
  let written = 0;
  let lostAck = options.lostAck;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const sourceBundle: SyncBundle = { id: 'export', size: CHUNK * 5, originalSize: CHUNK * 20,
    sha256: 'a'.repeat(64), sessionIds: ['thread'], resumeToken: 'source-token', chunkBytes: CHUNK };
  const destinationBundle = { ...sourceBundle, id: 'import', resumeToken: 'target-token', written: 0 };
  const sourceRequest = vi.fn(async (request: SyncRequest) => {
    if (request.action === 'resume') return { ...sourceBundle, written: sourceBundle.size };
    if (request.action === 'read') {
      if (options.hold && request.offset >= CHUNK) await gate;
      return { data: btoa('a'.repeat(CHUNK)) };
    }
    return {};
  });
  const destinationRequest = vi.fn(async (request: SyncRequest) => {
    if (request.action === 'resume') return { ...destinationBundle, written,
      sha256: options.badHash ? 'b'.repeat(64) : destinationBundle.sha256 };
    if (request.action === 'write') {
      expect(request.offset).toBe(written);
      written += atob(request.data).length;
      if (lostAck) { lostAck = false; throw new Error('connection lost after write'); }
      return { written };
    }
    if (request.action === 'commit') {
      expect(written).toBe(sourceBundle.size);
      return { completedCount: 1, skippedCount: 0 };
    }
    return {};
  });
  const host = (id: string, request: (request: SyncRequest) => Promise<unknown>): SyncHost => ({ id, owner, name: id,
    mode: () => 'direct', request: request as SyncHost['request'] });
  const source = host('source', sourceRequest);
  const destination = host('target', destinationRequest);
  return { source, destination, sourceRequest, destinationRequest, release: () => release!(),
    enqueue: () => enqueueSyncDownload({ source, destination, overwriteIds: [], provider: 'codex-switch-gui',
      prepared: { id: 'import', bundle: destinationBundle, plan: { count: 1, duplicateIds: [] },
        remote: { host: source, bundle: sourceBundle } } }) };
}

afterEach(async () => {
  for (const task of downloadManager.snapshot()) await downloadManager.remove(task.id);
  releaseSyncHosts(owner); storage.clear();
});

it('persists a download job, imports automatically and removes both temporary ZIPs', async () => {
  const sync = fixture();
  const id = await sync.enqueue();
  await vi.waitFor(() => expect(downloadManager.snapshot().find(task => task.id === id)?.status).toBe('completed'));
  const task = storage.get(id)!;
  expect(task.received).toBe(CHUNK * 5);
  expect(task.sync?.result).toEqual({ completedCount: 1, skippedCount: 0 });
  await vi.waitFor(() => expect(storage.get(id)?.sync?.cleanupPending).toBe(false));
  expect(sync.sourceRequest).toHaveBeenCalledWith({ action: 'close', id: 'export' });
  expect(sync.destinationRequest).toHaveBeenCalledWith({ action: 'close', id: 'import' });
});

it('pauses promptly during read-ahead and resumes the confirmed prefix after a manager restart', async () => {
  const sync = fixture({ hold: true });
  const id = await sync.enqueue();
  await vi.waitFor(() => expect(storage.get(id)?.received).toBe(CHUNK));
  await downloadManager.pause(id);
  expect(storage.get(id)?.status).toBe('paused');
  expect(sync.destinationRequest).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'commit' }));
  const restored = new WebDownloadManager();
  await restored.initialize(); sync.release();
  await restored.resume(id);
  await vi.waitFor(() => expect(restored.snapshot().find(task => task.id === id)?.status).toBe('completed'));
  const writes = sync.destinationRequest.mock.calls.map(([request]) => request)
    .filter(request => request.action === 'write');
  expect(writes.map(request => request.offset)).toEqual([0, CHUNK, CHUNK * 2, CHUNK * 3, CHUNK * 4]);
  await restored.remove(id);
});

it('recovers a lost write acknowledgement using the receiver offset instead of reuploading', async () => {
  const sync = fixture({ lostAck: true });
  const id = await sync.enqueue();
  await vi.waitFor(() => expect(downloadManager.snapshot().find(task => task.id === id)?.status).toBe('completed'),
    { timeout: 3000 });
  const writes = sync.destinationRequest.mock.calls.map(([request]) => request)
    .filter(request => request.action === 'write');
  expect(writes.map(request => request.offset)).toEqual([0, CHUNK, CHUNK * 2, CHUNK * 3, CHUNK * 4]);
});

it('rejects a mismatched resume archive without transmitting bytes or retrying the import', async () => {
  const sync = fixture({ badHash: true });
  const id = await sync.enqueue();
  await vi.waitFor(() => expect(downloadManager.snapshot().find(task => task.id === id)?.status).toBe('failed'));
  expect(downloadManager.retryAttempt(id)).toBe(0);
  expect(sync.destinationRequest).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'write' }));
  expect(sync.destinationRequest).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'commit' }));
});
