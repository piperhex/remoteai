import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); });
afterEach(() => vi.unstubAllGlobals());

it('deduplicates in-flight reads, isolates all query dimensions, and refreshes explicitly', async () => {
  const { readTokenQuery } = await import('../../../../../shared/token-usage/queryCache');
  let finish!: (value: number) => void;
  const load = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
  const key = JSON.stringify(['local', 100, 128000, 'provider-a']);
  const first = readTokenQuery({ key, load, maxAgeMs: 1000 });
  const second = readTokenQuery({ key, load, maxAgeMs: 1000 });
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  finish(42);
  expect(await first).toBe(42);
  expect(await second).toBe(42);
  expect(await readTokenQuery({ key, load, maxAgeMs: 1000 })).toBe(42);
  expect(load).toHaveBeenCalledOnce();
  const other = vi.fn(async () => 99);
  for (const dimensions of [['remote-device', 100, 128000, 'provider-a'], ['local', 200, 128000, 'provider-a'],
    ['local', 100, 272000, 'provider-a'], ['local', 100, 128000, 'provider-b']]) {
    expect(await readTokenQuery({ key: JSON.stringify(dimensions), load: other, maxAgeMs: 1000 })).toBe(99);
  }
  expect(other).toHaveBeenCalledTimes(4);
  await new Promise(resolve => setTimeout(resolve, 2));
  expect(await readTokenQuery({ key, load: other, maxAgeMs: 0 })).toBe(99);
  expect(other).toHaveBeenCalledTimes(5);
});

it('evicts by entry and byte budgets and does not retain failed or partial responses', async () => {
  const { readTokenQuery, MAX_QUERY_ENTRIES, MAX_QUERY_BYTES } = await import('../../../../../shared/token-usage/queryCache');
  const load = vi.fn(async () => 'small');
  for (let index = 0; index <= MAX_QUERY_ENTRIES; index++) {
    await readTokenQuery({ key: `key-${index}`, load, maxAgeMs: 1000 });
  }
  await readTokenQuery({ key: 'key-0', load, maxAgeMs: 1000 });
  expect(load).toHaveBeenCalledTimes(MAX_QUERY_ENTRIES + 2);
  const huge = vi.fn(async () => 'a'.repeat(MAX_QUERY_BYTES));
  await readTokenQuery({ key: 'huge', load: huge, maxAgeMs: 1000 });
  await readTokenQuery({ key: 'huge', load: huge, maxAgeMs: 1000 });
  expect(huge).toHaveBeenCalledTimes(2);
  const failed = vi.fn(async () => { throw new Error('offline'); });
  await expect(readTokenQuery({ key: 'failed', load: failed, maxAgeMs: 1000 })).rejects.toThrow('offline');
  await expect(readTokenQuery({ key: 'failed', load: failed, maxAgeMs: 1000 })).rejects.toThrow('offline');
  expect(failed).toHaveBeenCalledTimes(2);
  const partial = { key: 'partial', load, maxAgeMs: 1000, cacheable: () => false };
  await readTokenQuery(partial);
  await readTokenQuery(partial);
  expect(load).toHaveBeenCalledTimes(MAX_QUERY_ENTRIES + 4);
});

it('invalidates retired sources without letting their pending reads repopulate the cache', async () => {
  const { readTokenQuery, invalidateTokenQueries } = await import('../../../../../shared/token-usage/queryCache');
  let finish!: (value: number) => void;
  const old = readTokenQuery({ key: 'account-a:range', maxAgeMs: 1000,
    load: () => new Promise<number>(resolve => { finish = resolve; }) });
  await vi.waitFor(() => expect(finish).toBeDefined());
  await invalidateTokenQueries('account-a:');
  finish(1);
  await old;
  const load = vi.fn(async () => 2);
  expect(await readTokenQuery({ key: 'account-a:range', maxAgeMs: 1000, load })).toBe(2);
  expect(load).toHaveBeenCalledOnce();
});

it('falls back when Web Locks are denied without retrying a failed data request', async () => {
  const { readTokenQuery } = await import('../../../../../shared/token-usage/queryCache');
  const lock = vi.fn().mockRejectedValue(new Error('storage denied'));
  vi.stubGlobal('navigator', { locks: { request: lock } });
  const load = vi.fn(async () => 1);
  expect(await readTokenQuery({ key: 'denied', load, maxAgeMs: 0 })).toBe(1);
  expect(load).toHaveBeenCalledOnce();
  lock.mockImplementation((_key: string, run: () => Promise<unknown>) => run());
  const failed = vi.fn(async () => { throw new Error('offline'); });
  await expect(readTokenQuery({ key: 'offline', load: failed, maxAgeMs: 0 })).rejects.toThrow('offline');
  expect(failed).toHaveBeenCalledOnce();
});
