import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BulkBlockStore } from '../../../../shared/downloads/bulkStorage';
import { BULK_LIMITS } from '../../../../shared/remote-chat/bulkLimits';
import type { DownloadTask } from '../../../../shared/downloads/types';

interface Commit {
  task?: DownloadTask;
  ranges?: { offset: number; blob: Blob }[];
  finish: () => void;
  fail: (error: Error) => void;
}
const storage = vi.hoisted(() => ({ commits: [] as Commit[] }));
vi.mock('../../../../shared/downloads/storage', () => ({
  openDownloadDatabase: async () => ({ transaction: () => {
    const commit: Commit = { finish: () => {}, fail: () => {} };
    const completed = new Promise<void>((resolve, reject) => { commit.finish = resolve; commit.fail = reject; });
    storage.commits.push(commit);
    return { completed, objectStore: () => ({ commit, put: (task: DownloadTask) => { commit.task = task; } }) };
  } }),
  complete: (transaction: { completed: Promise<void> }) => transaction.completed,
}));
vi.mock('../../../../shared/downloads/chunkRanges', () => ({
  replaceChunkRanges: (store: { commit: Commit }, _id: string, ranges: Commit['ranges']) => {
    store.commit.ranges = ranges;
  },
}));

function task(size = BULK_LIMITS.blockBytes * 2): DownloadTask {
  return { id: crypto.randomUUID(), name: 'sample.bin', received: 0, size, createdAt: 0,
    status: 'downloading', message: '', source: { owner: 'owner', deviceId: 'pc', deviceName: 'PC',
      scope: 'computer', path: 'sample.bin' },
    manifest: { version: 1, algorithm: 'sha256', size, blockSize: BULK_LIMITS.blockBytes,
      blockCount: Math.ceil(size / BULK_LIMITS.blockBytes), manifestId: 'manifest',
      fileHash: 'hash', sourceVersion: 'revision' },
    checkpoint: { version: 1, manifestId: 'manifest', size, blockSize: BULK_LIMITS.blockBytes,
      temporaryId: 'temporary', sequence: 0, committed: [] } };
}

// Drain promise jobs without advancing the storage timer that caused the throughput cap.
async function settle() { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); }
beforeEach(() => { storage.commits = []; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

it('commits a partial final block without needing another block or a timer', async () => {
  const original = task(17), update = vi.fn(), store = new BulkBlockStore(original, update);
  const resolved = vi.fn();
  const writing = store.write(0, new Uint8Array(17)).then(resolved);
  await settle();
  expect(storage.commits).toHaveLength(1);
  expect(resolved).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(store.snapshot()).toBe(original);
  storage.commits[0].finish(); await writing;
  expect(store.snapshot().received).toBe(17);
  expect(store.snapshot().checkpoint?.committed).toEqual([0]);
  expect(update).toHaveBeenCalledOnce();
  await store.close();
});

it('commits a full two-block window and its bitmap atomically', async () => {
  const store = new BulkBlockStore(task(), vi.fn());
  const writes = [0, 1].map(block => store.write(block, new Uint8Array(BULK_LIMITS.blockBytes)));
  await settle();
  expect(storage.commits).toHaveLength(1);
  expect(storage.commits[0].ranges?.map(range => range.offset)).toEqual([0, BULK_LIMITS.blockBytes]);
  expect(storage.commits[0].task?.checkpoint?.committed).toEqual([0, 1]);
  storage.commits[0].finish(); await Promise.all(writes); await store.close();
  expect(store.snapshot().received).toBe(BULK_LIMITS.peerRequestBytes);
});

it('lets two files sharing one peer window each commit a single block', async () => {
  const stores = [new BulkBlockStore(task(), vi.fn()), new BulkBlockStore(task(), vi.fn())];
  const writes = stores.map(store => store.write(0, new Uint8Array(BULK_LIMITS.blockBytes)));
  await settle();
  expect(storage.commits).toHaveLength(2);
  storage.commits.forEach(commit => commit.finish());
  await Promise.all(writes);
  expect(stores.map(store => store.snapshot().received)).toEqual([BULK_LIMITS.blockBytes, BULK_LIMITS.blockBytes]);
  await Promise.all(stores.map(store => store.close()));
});

it('serializes slow transactions and acknowledges only committed bytes', async () => {
  const store = new BulkBlockStore(task(), vi.fn());
  const first = store.write(0, new Uint8Array(BULK_LIMITS.blockBytes));
  await settle();
  const second = store.write(1, new Uint8Array(BULK_LIMITS.blockBytes));
  await settle();
  expect(storage.commits).toHaveLength(1);
  expect(store.snapshot().received).toBe(0);
  storage.commits[0].finish(); await first; await settle();
  expect(storage.commits).toHaveLength(2);
  expect(store.snapshot().checkpoint?.committed).toEqual([0]);
  expect(storage.commits[1].task?.checkpoint?.committed).toEqual([0, 1]);
  storage.commits[1].finish(); await second; await store.close();
});

it('rejects queued and subsequent writes after a failed transaction without advancing the checkpoint', async () => {
  const original = task(), update = vi.fn(), store = new BulkBlockStore(original, update);
  const first = store.write(0, new Uint8Array(BULK_LIMITS.blockBytes));
  await settle();
  const second = store.write(1, new Uint8Array(BULK_LIMITS.blockBytes));
  const results = Promise.allSettled([first, second]);
  await settle();
  const error = new Error('storage unavailable');
  storage.commits[0].fail(error);
  expect(await results).toEqual([{ status: 'rejected', reason: error }, { status: 'rejected', reason: error }]);
  expect(storage.commits).toHaveLength(1);
  expect(store.snapshot()).toBe(original);
  expect(update).not.toHaveBeenCalled();
  await expect(store.write(0, new Uint8Array(1))).rejects.toBe(error);
  await expect(store.close()).rejects.toBe(error);
});

it('close waits for a write queued in the same turn', async () => {
  const store = new BulkBlockStore(task(17), vi.fn());
  const writing = store.write(0, new Uint8Array(17));
  const resolved = vi.fn(), closing = store.close().then(resolved);
  await settle();
  expect(resolved).not.toHaveBeenCalled();
  storage.commits[0].finish(); await writing; await closing;
  expect(store.snapshot().received).toBe(17);
});
