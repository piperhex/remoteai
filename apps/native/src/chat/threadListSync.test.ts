import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ChatConnection, ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import type { ListResponse, Thread } from './types';
import { HISTORY_CHANGED } from '../../../../shared/remote-chat/historySync';

const thread: Thread = { id: 'chat', name: 'Original', preview: '', cwd: '/project', updatedAt: 1 };
let controller: ChatController;
let events: ConnectionEvents;
const request = vi.fn<ChatConnection['request']>();

beforeEach(async () => {
  request.mockReset().mockImplementation(async (method, body) => method === 'connect' ? []
    : { data: (body as { operation?: string })?.operation === 'list' ? [thread] : [], nextCursor: null });
  controller = new ChatController(callbacks => {
    events = callbacks;
    return { start() { events.mode('relay'); events.ready(); }, stop() {},
      request: <T>(...args: Parameters<ChatConnection['request']>) => request(...args) as Promise<T> };
  });
  controller.start();
  await vi.waitFor(() => expect(controller.snapshot().ready).toBe(true));
  request.mockClear();
  vi.useFakeTimers();
});
afterEach(() => { controller.stop(); vi.useRealTimers(); });

function pendingPage() {
  let finish!: (value: ListResponse<Thread>) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  return (data = [thread]) => finish({ data, nextCursor: null });
}

function notify(count = 1) {
  for (let index = 0; index < count; index++) events.event({ method: HISTORY_CHANGED,
    params: { threadId: thread.id, reason: 'thread/resumed' } });
}

it('coalesces event bursts and applies an in-flight page before one trailing refresh', async () => {
  const finish = pendingPage();
  notify(100);
  expect(request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(150);
  expect(request).toHaveBeenCalledTimes(1);
  expect(controller.snapshot()).toMatchObject({ loading: true, listRefreshing: false, threads: [thread] });
  notify(100);
  await vi.advanceTimersByTimeAsync(1000);
  expect(request).toHaveBeenCalledTimes(1);
  const incoming = { ...thread, name: 'First response' };
  finish([incoming]);
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.snapshot().threads).toEqual([incoming]);
  const latest = { ...thread, name: 'Latest response' };
  request.mockResolvedValueOnce({ data: [latest], nextCursor: null });
  await vi.advanceTimersByTimeAsync(150);
  expect(request).toHaveBeenCalledTimes(2);
  expect(controller.snapshot()).toMatchObject({ loading: false, listRefreshing: false, threads: [latest] });
  expect(vi.getTimerCount()).toBe(0);
});

it('joins identical manual pulls to the pending automatic request and shows manual progress', async () => {
  const finish = pendingPage();
  notify();
  await vi.advanceTimersByTimeAsync(150);
  const first = controller.list();
  const second = controller.list();
  expect(first).toBe(second);
  expect(request).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().listRefreshing).toBe(true);
  finish();
  await Promise.all([first, second]);
  expect(controller.snapshot()).toMatchObject({ loading: false, listRefreshing: false });
});

it('keeps a newer archive filter when an older request arrives late', async () => {
  const finish = pendingPage();
  const previous = controller.list();
  const archived = { ...thread, id: 'archived' };
  request.mockResolvedValueOnce({ data: [archived], nextCursor: null });
  await controller.list({ archived: true });
  finish();
  await previous;
  expect(controller.snapshot()).toMatchObject({ archived: true, threads: [archived], loading: false });
});

it('waits for pagination before refreshing notifications and does not show pull progress for more pages', async () => {
  Object.assign(controller.snapshot(), { cursor: 'next' });
  const finish = pendingPage();
  const more = controller.list({ more: true });
  notify(20);
  await vi.advanceTimersByTimeAsync(1000);
  expect(request).toHaveBeenCalledTimes(1);
  expect(controller.snapshot().listRefreshing).toBe(false);
  const older = { ...thread, id: 'older' };
  finish([older]);
  await more;
  expect(controller.snapshot().threads).toEqual([thread, older]);
  await vi.advanceTimersByTimeAsync(150);
  expect(request).toHaveBeenCalledTimes(2);
});

it.each(['stop', 'disconnect'] as const)('cancels pending work on %s', async action => {
  const finish = pendingPage();
  const pending = controller.list();
  notify();
  if (action === 'stop') controller.stop();
  else events.mode('offline');
  finish([{ ...thread, name: 'Stale' }]);
  await pending;
  await vi.advanceTimersByTimeAsync(1000);
  expect(request).toHaveBeenCalledTimes(1);
  expect(controller.snapshot()).toMatchObject({ threads: [thread], loading: false, listRefreshing: false });
  expect(vi.getTimerCount()).toBe(0);
});

it('clears failed refresh progress and allows an explicit retry', async () => {
  request.mockRejectedValueOnce(new Error('Refresh unavailable'));
  await controller.list();
  expect(controller.snapshot()).toMatchObject({ loading: false, listRefreshing: false, threads: [thread] });
  await controller.list();
  expect(request).toHaveBeenCalledTimes(2);
});
