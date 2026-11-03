import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_REQUEST_TIMEOUT_MS, SESSION_REFRESH_TIMEOUT_MS, type DeadlineRequestInit } from '../requestDeadline';
import { MappingSync } from '../../port-mapping/sync';
import { PortForwardingService } from '../../port-mapping/service';

export const credentials = () => ({ baseUrl: 'https://fixture.invalid', email: 'owner@fixture.invalid',
  accessToken: 'old-access', refreshToken: 'old-refresh' });
export const renewed = { accessToken: 'new-access', refreshToken: 'new-refresh' };
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

interface Client {
  setup(): Promise<void>;
  request(path: string, init?: DeadlineRequestInit): Promise<Response>;
  refresh(options?: Pick<RequestInit, 'signal'>): Promise<unknown>;
  replace(session: ReturnType<typeof credentials>): Promise<void>;
  current(): ReturnType<typeof credentials> | null;
}

export function adminClientContract(client: Client) {
  beforeEach(async () => { await client.setup(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  describe('finite admin requests', () => {
    it('preserves headers, body, status and explicit long budgets', async () => {
      const fetch = vi.fn(async (_input: string, _init: RequestInit) => json({ ok: true }));
      vi.stubGlobal('fetch', fetch);
      const response = await client.request('/write', { method: 'POST', body: '{}', timeoutMs: 90_000 });
      expect(await response.json()).toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledOnce();
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer old-access');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds a connection that never settles, keeps login and never retries a write', async () => {
      const fetch = vi.fn(() => new Promise<Response>(() => undefined));
      vi.stubGlobal('fetch', fetch);
      const result = expect(client.request('/write', { method: 'POST', body: '{}' }))
        .rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(ADMIN_REQUEST_TIMEOUT_MS);
      await result;
      expect(fetch).toHaveBeenCalledOnce();
      expect(client.current()?.accessToken).toBe('old-access');
      expect(vi.getTimerCount()).toBe(0);
      vi.stubGlobal('fetch', vi.fn(async () => json({ retried: true })));
      expect(await (await client.request('/read')).json()).toEqual({ retried: true });
    });

    it.each([200, 401, 500])('times out a stalled body after HTTP %s headers', async status => {
      let signal!: AbortSignal;
      vi.stubGlobal('fetch', vi.fn(async (_input, init: RequestInit) => {
        signal = init.signal!;
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode('{'));
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        } }), { status });
      }));
      const result = expect(client.request('/body', { timeoutMs: 20 })).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(20);
      await result;
      expect(signal.aborted).toBe(true);
      expect(client.current()?.accessToken).toBe('old-access');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('honors cancellation before dispatch and during a non-cooperative fetch', async () => {
      const fetch = vi.fn(() => new Promise<Response>(() => undefined));
      vi.stubGlobal('fetch', fetch);
      const caller = new AbortController();
      caller.abort();
      await expect(client.request('/read', { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetch).not.toHaveBeenCalled();
      const next = new AbortController();
      const result = expect(client.request('/read', { signal: next.signal }))
        .rejects.toMatchObject({ name: 'AbortError' });
      next.abort();
      await result;
      expect(vi.getTimerCount()).toBe(0);
      expect(client.current()).not.toBeNull();
    });

    it('releases the actual mapping sync busy flag so the next refresh can recover', async () => {
      const service = new PortForwardingService({ openResource: async () => 'resource',
        closeResource: async () => {}, link: async () => ({ type: 'done' }) }, [], {
        createId: () => 'id', createTunnel: () => ({ resolve: async (_id, url) => url, close: async () => {} }),
      });
      const sync = new MappingSync(service, { scope: 'fixture',
        storage: { getItem: () => null, setItem: () => undefined },
        exchange: async () => (await client.request('/devices/fixture/port-mappings')).json(),
      });
      try {
        vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
        const pending = sync.refresh();
        await vi.advanceTimersByTimeAsync(ADMIN_REQUEST_TIMEOUT_MS);
        await pending;
        expect(sync.isSynced()).toBe(false);
        vi.stubGlobal('fetch', vi.fn(async () => json({ revision: 1, mappings: [] })));
        await sync.refresh();
        expect(sync.isSynced()).toBe(true);
      } finally { service.dispose(); }
    });
  });

  describe('shared refresh', () => {
    it('shares concurrent 401 refreshes while cancelling only one waiter', async () => {
      const refresh = deferred<Response>();
      const started = deferred<void>();
      let refreshCount = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
        if (input.endsWith('/auth/refresh')) { refreshCount++; started.resolve(); return refresh.promise; }
        return new Headers(init.headers).get('Authorization') === 'Bearer old-access'
          ? json({}, 401) : json({ ok: true });
      }));
      const caller = new AbortController();
      const cancelled = expect(client.request('/read', { signal: caller.signal }))
        .rejects.toMatchObject({ name: 'AbortError' });
      const success = client.request('/read');
      await started.promise;
      caller.abort();
      await cancelled;
      refresh.resolve(json(renewed));
      expect(await (await success).json()).toEqual({ ok: true });
      expect(refreshCount).toBe(1);
      expect(client.current()).toMatchObject(renewed);
      // jsdom dispatches localStorage changes on a zero-delay timer.
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('releases a timed out refresh so the next attempt can succeed', async () => {
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
      const results = Promise.all([client.refresh(), client.refresh()].map(pending =>
        expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })));
      await vi.advanceTimersByTimeAsync(SESSION_REFRESH_TIMEOUT_MS);
      await results;
      expect(client.current()?.accessToken).toBe('old-access');
      vi.stubGlobal('fetch', vi.fn(async () => json(renewed)));
      await client.refresh();
      expect(client.current()).toMatchObject(renewed);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds refresh response bodies and ignores a response arriving after the deadline', async () => {
      const late = deferred<Response>();
      vi.stubGlobal('fetch', vi.fn(() => late.promise));
      const result = expect(client.refresh()).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(SESSION_REFRESH_TIMEOUT_MS);
      await result;
      late.resolve(json(renewed));
      await vi.advanceTimersByTimeAsync(0);
      expect(client.current()?.accessToken).toBe('old-access');
      vi.stubGlobal('fetch', vi.fn(async (_input, init: RequestInit) => new Response(new ReadableStream({
        start(controller) {
          init.signal!.addEventListener('abort', () => controller.error(new Error('fixture')), { once: true });
        },
      }))));
      const bodyResult = expect(client.refresh()).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(SESSION_REFRESH_TIMEOUT_MS);
      await bodyResult;
      expect(client.current()?.accessToken).toBe('old-access');
    });

    it('a short caller deadline does not cancel a longer shared refresh', async () => {
      const work = deferred<Response>();
      const started = deferred<void>();
      let refreshSignal!: AbortSignal;
      vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
        if (input.endsWith('/auth/refresh')) {
          refreshSignal = init.signal!; started.resolve(); return work.promise;
        }
        return new Headers(init.headers).get('Authorization') === 'Bearer old-access' ? json({}, 401) : json({ ok: true });
      }));
      const result = expect(client.request('/read', { timeoutMs: 100 })).rejects.toMatchObject({ name: 'TimeoutError' });
      const other = client.request('/read');
      await started.promise;
      await vi.advanceTimersByTimeAsync(100);
      await result;
      expect(refreshSignal.aborted).toBe(false);
      work.resolve(json(renewed));
      expect((await other).ok).toBe(true);
    });

    it('retains credentials after network/503 errors and retries only when called again', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
      await expect(client.refresh()).rejects.toBeInstanceOf(Error);
      expect(client.current()?.accessToken).toBe('old-access');
      vi.stubGlobal('fetch', vi.fn(async () => json({}, 503)));
      await expect(client.refresh()).rejects.toMatchObject({ status: 503 });
      expect(client.current()?.accessToken).toBe('old-access');
      vi.stubGlobal('fetch', vi.fn(async () => json(renewed)));
      await client.refresh();
      expect(client.current()).toMatchObject(renewed);
    });

    it.each([200, 401, 403])('never writes or clears a replacement account after late refresh HTTP %s', async status => {
      const old = deferred<Response>();
      vi.stubGlobal('fetch', vi.fn(() => old.promise));
      const result = expect(client.refresh()).rejects.toBeInstanceOf(Error);
      const replacement = { ...credentials(), baseUrl: 'https://other.invalid', email: 'other@fixture.invalid' };
      await client.replace(replacement);
      old.resolve(json(renewed, status));
      await result;
      expect(client.current()).toEqual(replacement);
      vi.stubGlobal('fetch', vi.fn(async () => json(renewed)));
      await client.refresh();
      expect(client.current()).toMatchObject({ ...replacement, ...renewed });
    });

    it('does not replay an old request under a replacement account after a delayed 401', async () => {
      const old = deferred<Response>();
      const fetch = vi.fn(() => old.promise);
      vi.stubGlobal('fetch', fetch);
      const result = expect(client.request('/write', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(Error);
      const replacement = { ...credentials(), baseUrl: 'https://other.invalid' };
      await client.replace(replacement);
      old.resolve(json({}, 401));
      await result;
      expect(fetch).toHaveBeenCalledOnce();
      expect(client.current()).toEqual(replacement);
    });

    it('reuses rotated credentials for a delayed 401 instead of rotating twice', async () => {
      const late = deferred<Response>();
      let count = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
        if (input.endsWith('/auth/refresh')) { count++; return json(renewed); }
        const oldToken = new Headers(init.headers).get('Authorization') === 'Bearer old-access';
        return oldToken ? (input.endsWith('/late') ? late.promise : json({}, 401)) : json({ ok: true });
      }));
      const pending = client.request('/late');
      await client.request('/early');
      late.resolve(json({}, 401));
      expect((await pending).ok).toBe(true);
      expect(count).toBe(1);
    });

    it('does not revoke newer credentials when a previous retry returns 401 late', async () => {
      const retry = deferred<Response>();
      const started = deferred<void>();
      const newest = { accessToken: 'latest-access', refreshToken: 'latest-refresh' };
      let rotations = 0;
      let requests = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: string) => {
        if (input.endsWith('/auth/refresh')) return json(++rotations === 1 ? renewed : newest);
        if (++requests === 1) return json({}, 401);
        started.resolve(); return retry.promise;
      }));
      const pending = expect(client.request('/write', { method: 'POST' })).rejects.toBeInstanceOf(Error);
      await started.promise;
      await client.refresh();
      retry.resolve(json({}, 401));
      await pending;
      expect(client.current()).toMatchObject(newest);
      expect(requests).toBe(2);
    });
  });
}
