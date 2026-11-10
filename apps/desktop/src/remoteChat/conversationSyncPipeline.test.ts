import { expect, it, vi } from 'vitest';
import { uploadPreparedSync, type PreparedSync } from '../../../../shared/conversation/sync/transfer';
import { SYNC_CHUNK_BYTES as CHUNK, type SyncHost } from '../../../../shared/conversation/sync/types';

it('prefetches four large ranges and preserves write order when reads finish out of order', async () => {
  const pending = new Map<number, (value: { data: string }) => void>();
  const source: SyncHost = { id: 'source', name: '', request: vi.fn(request => {
    if (request.action !== 'read') throw new Error('unexpected request');
    expect(request.length).toBe(CHUNK);
    return new Promise(resolve => { pending.set(request.offset, resolve as (value: { data: string }) => void); });
  }) as SyncHost['request'] };
  const destination: SyncHost = { id: 'target', name: '', request: vi.fn(async () => ({})) as SyncHost['request'] };
  const bundle = { id: 'bundle', size: CHUNK * 5, sha256: 'hash', sessionIds: ['thread'], chunkBytes: CHUNK };
  const prepared: PreparedSync = { id: 'incoming', bundle, plan: { count: 1, duplicateIds: [] },
    remote: { host: source, bundle } };
  const progress = vi.fn();
  const run = uploadPreparedSync({ prepared, destination, signal: new AbortController().signal, progress });
  expect(pending.size).toBe(4);
  const data = btoa('a'.repeat(CHUNK));
  pending.get(CHUNK * 3)!({ data }); pending.get(CHUNK * 2)!({ data }); pending.get(CHUNK)!({ data });
  await Promise.resolve();
  expect(destination.request).not.toHaveBeenCalled();
  pending.get(0)!({ data });
  await vi.waitFor(() => expect(pending.size).toBe(5));
  pending.get(CHUNK * 4)!({ data }); await run;
  expect(vi.mocked(destination.request).mock.calls.map(([request]) => 'offset' in request && request.offset))
    .toEqual([0, CHUNK, CHUNK * 2, CHUNK * 3, CHUNK * 4]);
  expect(progress).toHaveBeenLastCalledWith(1, CHUNK);
});

it('rejects a truncated compressed chunk before acknowledging or importing it', async () => {
  const source: SyncHost = { id: 'source', name: '', request: vi.fn(async () => ({ data: 'YQ==' })) as SyncHost['request'] };
  const destination: SyncHost = { id: 'target', name: '', request: vi.fn() };
  const bundle = { id: 'bundle', size: CHUNK, sha256: 'hash', sessionIds: [], chunkBytes: CHUNK };
  const prepared: PreparedSync = { id: 'incoming', bundle, plan: { count: 1, duplicateIds: [] },
    remote: { host: source, bundle } };
  await expect(uploadPreparedSync({ prepared, destination,
    signal: new AbortController().signal, progress: vi.fn() })).rejects.toThrow('CONVERSATION_SYNC_INVALID');
  expect(destination.request).not.toHaveBeenCalled();
});
