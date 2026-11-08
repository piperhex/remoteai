import { expect, it, vi } from 'vitest';
import { ThreadListCache } from '../../../../shared/remote-chat/client/threadListCache';
import type { ListResponse, Thread } from '../../../../shared/remote-chat/client/types';

const thread: Thread = { id: 'one', name: 'Original', preview: 'question', cwd: '/project', updatedAt: 1 };
const active = { archived: false };
const archived = { archived: true };
const page = (data: Thread[], nextCursor: string | null = null) => ({ data, nextCursor });

it('retains complete loaded pagination and empty tabs without extra reads', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(page([thread], 'older'))
    .mockResolvedValueOnce(page([{ ...thread, id: 'older' }]))
    .mockResolvedValueOnce(page([]));
  const cache = new ThreadListCache(fetch);
  await cache.read(active);
  await cache.read({ ...active, cursor: 'older' });
  await cache.read(archived);
  expect(await cache.read(active)).toEqual(page([thread, { ...thread, id: 'older' }]));
  expect(await cache.read(archived)).toEqual(page([]));
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('deduplicates concurrent loads and retries rejected reads', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(page([thread]));
  const cache = new ThreadListCache(fetch);
  const first = cache.read(active);
  expect(cache.read(active)).toBe(first);
  await expect(first).rejects.toThrow('unavailable');
  expect(await cache.read(active)).toEqual(page([thread]));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('updates rename, archive, restore and delete across previously loaded tabs', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(page([thread])).mockResolvedValueOnce(page([]));
  const cache = new ThreadListCache(fetch);
  await cache.read(active);
  await cache.read(archived);
  cache.receive({ method: 'thread/name/updated', params: { threadId: 'one', threadName: 'Renamed' } });
  cache.receive({ method: 'thread/archived', params: { threadId: 'one' } });
  expect((await cache.read(active)).data).toEqual([]);
  expect((await cache.read(archived)).data).toEqual([{ ...thread, name: 'Renamed' }]);
  cache.receive({ method: 'thread/unarchived', params: { threadId: 'one' } });
  expect((await cache.read(active)).data[0].name).toBe('Renamed');
  expect((await cache.read(archived)).data).toEqual([]);
  cache.remove('one');
  expect((await cache.read(active)).data).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('keeps writes and deletions newer than a slow list response', async () => {
  let finish!: (result: ListResponse<Thread>) => void;
  const fetch = vi.fn().mockResolvedValueOnce(page([thread, { ...thread, id: 'deleted' }]))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const cache = new ThreadListCache(fetch);
  await cache.read(active);
  const loading = cache.read(active, true);
  cache.upsert({ ...thread, name: 'New name' }, false);
  cache.remove('deleted');
  cache.upsert({ ...thread, id: 'created' }, false);
  finish(page([thread, { ...thread, id: 'deleted' }]));
  expect((await loading).data).toEqual([{ ...thread, id: 'created' }, { ...thread, name: 'New name' }]);
  expect(await cache.read(active)).toEqual(await loading);
});

it('revalidates after an outage and does not cache responses from the previous connection', async () => {
  let finish!: (result: ListResponse<Thread>) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(page([{ ...thread, name: 'New connection' }]));
  const cache = new ThreadListCache(fetch);
  const old = cache.read(active);
  cache.invalidate();
  await cache.read(active);
  finish(page([thread]));
  await old;
  expect((await cache.read(active)).data[0].name).toBe('New connection');
});

it('keeps searches separate and rechecks their membership after a title change', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(page([thread])).mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([{ ...thread, name: 'Match' }]));
  const cache = new ThreadListCache(fetch);
  const search = { ...active, search: 'Match' };
  await cache.read(active);
  await cache.read(search);
  await cache.read(search);
  expect(fetch).toHaveBeenCalledTimes(2);
  cache.receive({ method: 'thread/name/updated', params: { threadId: thread.id, threadName: 'Match' } });
  expect((await cache.read(search)).data[0].name).toBe('Match');
  expect((await cache.read(active)).data[0].name).toBe('Match');
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('never retains history and does not share summaries between sessions', async () => {
  const fetch = vi.fn().mockResolvedValue(page([{ ...thread,
    turns: [{ id: 'turn', status: 'completed', items: [{ id: 'item', type: 'agentMessage', text: 'large history' }] }],
  }]));
  const first = new ThreadListCache(fetch);
  const second = new ThreadListCache(fetch);
  expect((await first.read(active)).data).toEqual([thread]);
  first.upsert({ ...thread, name: 'First device' }, false);
  expect((await second.read(active)).data).toEqual([thread]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('updates activity on start and completion without moving backwards or waiting for another list', async () => {
  const fetch = vi.fn().mockResolvedValue(page([{ ...thread, id: 'recent', updatedAt: 20 }, thread]));
  const cache = new ThreadListCache(fetch);
  await cache.read(active);
  cache.receive({ method: 'turn/started', params: { threadId: thread.id,
    turn: { id: 'turn', status: 'inProgress', items: [], startedAt: 30 } } });
  expect(cache.peek(active)?.data[0]).toMatchObject({ id: thread.id, updatedAt: 30, status: { type: 'active' } });
  cache.receive({ method: 'turn/completed', params: { threadId: thread.id,
    turn: { id: 'turn', status: 'completed', items: [], completedAt: 40 } } });
  expect(cache.peek(active)?.data[0]).toMatchObject({ id: thread.id, updatedAt: 40, status: { type: 'idle' } });
  cache.receive({ method: 'turn/started', params: { threadId: thread.id,
    turn: { id: 'older-turn', status: 'inProgress', items: [], startedAt: 10 } } });
  expect(cache.peek(active)?.data[0].updatedAt).toBe(40);
  expect(fetch).toHaveBeenCalledTimes(1);
});
