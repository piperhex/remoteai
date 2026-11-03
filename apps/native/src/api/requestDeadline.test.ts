import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchBufferedResponse, waitWithSignal, withRequestDeadline } from '../../../../shared/http/requestDeadline';
import { deferred } from '../../../../shared/http/testing/adminClientContract';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('cleans caller listeners and timers on success, rejection, timeout and cancellation', async () => {
  vi.useFakeTimers();
  for (const outcome of ['success', 'failure', 'timeout', 'cancel']) {
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, 'addEventListener');
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const work = deferred<string>();
    const pending = withRequestDeadline({ signal: caller.signal, timeoutMs: 10, timeoutMessage: 'fixture' },
      () => outcome === 'failure' ? Promise.reject(new Error('fixture')) : work.promise);
    const checked = outcome === 'success' ? expect(pending).resolves.toBe('done') : expect(pending).rejects.toBeDefined();
    if (outcome === 'success') work.resolve('done');
    if (outcome === 'cancel') caller.abort();
    if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(10);
    await checked;
    expect(remove.mock.calls[0]?.[1]).toBe(add.mock.calls[0]?.[1]);
    expect(vi.getTimerCount()).toBe(0);
  }
});

it('removes an already-aborted waiter listener without cancelling shared work', async () => {
  const caller = new AbortController();
  caller.abort();
  const remove = vi.spyOn(caller.signal, 'removeEventListener');
  const work = deferred<string>();
  await expect(waitWithSignal(work.promise, caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(remove).toHaveBeenCalledOnce();
  work.resolve('done');
  await expect(work.promise).resolves.toBe('done');
});

it('preserves the timeout category on older native AbortController implementations without reason', async () => {
  vi.useFakeTimers();
  const Original = AbortController;
  vi.stubGlobal('AbortController', class extends Original { abort() { super.abort(); } });
  const result = expect(withRequestDeadline({ timeoutMs: 10, timeoutMessage: 'fixture' },
    () => new Promise(() => undefined))).rejects.toMatchObject({ name: 'TimeoutError', message: 'fixture' });
  await vi.advanceTimersByTimeAsync(10);
  await result;
});

it('allows an explicit budget longer than the ordinary request deadline', async () => {
  vi.useFakeTimers();
  const work = deferred<string>();
  const pending = withRequestDeadline({ timeoutMs: 90_000, timeoutMessage: 'fixture' }, () => work.promise);
  await vi.advanceTimersByTimeAsync(30_001);
  work.resolve('done');
  await expect(pending).resolves.toBe('done');
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['/no-headers', '/stalled-body'])('aborts a real localhost HTTP fixture at %s', async path => {
  const disconnected = deferred<void>();
  const server = createServer((request, response) => {
    request.on('close', () => disconnected.resolve());
    if (path === '/stalled-body') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture address');
    await expect(withRequestDeadline({ timeoutMs: 150, timeoutMessage: 'fixture' }, signal =>
      fetchBufferedResponse(`http://127.0.0.1:${address.port}${path}`, { signal })))
      .rejects.toMatchObject({ name: 'TimeoutError' });
    await disconnected.promise;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
