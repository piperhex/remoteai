import { afterEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import type { ConnectionEvents } from '../../../../shared/remote-chat/client/connection';
import type { GuiEvent, Thread } from '../../../../shared/remote-chat/client/types';
import { historyDelta } from '../../../../shared/remote-chat/historySync';

const reductions = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../../shared/remote-chat/client/events', async original => {
  const actual = await original<typeof import('../../../../shared/remote-chat/client/events')>();
  return { ...actual, applyChatEvent: (...args: Parameters<typeof actual.applyChatEvent>) => {
    if (args[1].method === 'item/agentMessage/delta') reductions.count++;
    return actual.applyChatEvent(...args);
  } };
});

afterEach(() => { vi.useRealTimers(); });
const thread: Thread = { id: 'one', cwd: '', preview: '', updatedAt: 1, turns: [
  { id: 'turn', status: 'inProgress', items: [{ id: 'answer', type: 'agentMessage', text: '' }] },
] };
const textDelta = (delta: string): GuiEvent => ({ method: 'item/agentMessage/delta',
  params: { threadId: 'one', turnId: 'turn', itemId: 'answer', delta } });

async function fixture() {
  let events!: ConnectionEvents;
  const controller = new ChatController(callbacks => {
    events = callbacks;
    return { start() {}, stop() {}, request: async <T>(_method: string, body?: unknown) => {
      const operation = (body as { operation?: string })?.operation;
      return (operation === 'syncHistory' ? historyDelta(thread) : { data: [], nextCursor: null }) as T;
    } };
  });
  await controller.select(thread);
  vi.useFakeTimers();
  const changed = vi.fn(); controller.subscribe(changed);
  reductions.count = 0;
  const received = vi.fn(); controller.subscribeEvents(received);
  const text = () => controller.snapshot().selected?.turns?.[0].items[0].text;
  return { controller, events, changed, received, text };
}

it('reduces a burst once, notifies raw event subscribers in order and shows intermediate text', async () => {
  const { controller, events, changed, received, text } = await fixture();
  try {
    for (let index = 0; index < 100; index++) events.event(textDelta(`${index},`));
    expect(changed).toHaveBeenCalledTimes(process.env.CHAT_STREAM_BASELINE ? 100 : 0);
    expect(received).toHaveBeenCalledTimes(100);
    vi.advanceTimersByTime(32);
    process.stdout.write(`STREAM_COUNTS ${JSON.stringify({ reductions: reductions.count,
      notifications: changed.mock.calls.length, rawEvents: received.mock.calls.length })}\n`);
    const expected = process.env.CHAT_STREAM_BASELINE ? 100 : 1;
    expect(changed).toHaveBeenCalledTimes(expected); expect(reductions.count).toBe(expected);
    expect(text()).toBe(Array.from({ length: 100 }, (_, index) => `${index},`).join(''));
    events.event(textDelta('tail')); vi.advanceTimersByTime(32);
    expect(text()).toMatch(/99,tail$/);
  } finally { controller.stop(); }
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['completed', 'interrupted', 'failed'])('flushes text before a %s terminal snapshot', async status => {
  const { controller, events, text } = await fixture();
  try {
    events.event(textDelta('A')); events.event(textDelta('B'));
    events.event({ method: 'turn/completed', params: { threadId: 'one',
      turn: { id: 'turn', status, items: [] } } });
    expect(text()).toBe('AB'); expect(controller.snapshot().selected?.turns?.[0].status).toBe(status);
  } finally { controller.stop(); }
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['error', 'connection/closed'])('flushes before %s', async method => {
  const { controller, events, text } = await fixture();
  try {
    events.event(textDelta('kept'));
    events.event({ method, params: { threadId: 'one', turnId: 'turn', error: { message: 'failed' } } });
    expect(text()).toBe('kept');
  } finally { controller.stop(); }
  expect(vi.getTimerCount()).toBe(0);
});

it('flushes on cancellation, switching threads, reopening cached history and teardown', async () => {
  const { controller, events, text } = await fixture();
  events.event(textDelta('before cancel')); await controller.interrupt();
  expect(text()).toBe('before cancel');
  events.event(textDelta(' before switch'));
  await controller.select({ ...thread, id: 'two', turns: [] });
  expect(controller.snapshot().selected?.id).toBe('two');
  vi.advanceTimersByTime(32);
  expect(controller.snapshot().selected?.turns).toEqual([]);
  await controller.select(thread);
  expect(text()).toBe('before cancel before switch');
  events.event(textDelta(' before stop')); controller.stop();
  expect(text()).toBe('before cancel before switch before stop');
  events.event(textDelta(' late delivery'));
  vi.advanceTimersByTime(100);
  expect(text()).toBe('before cancel before switch before stop');
  expect(vi.getTimerCount()).toBe(0);
});
