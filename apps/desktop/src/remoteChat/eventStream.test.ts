import { afterEach, expect, it, vi } from 'vitest';
import { EventStream } from './eventStream';
import { historyNotification } from '../../../../shared/remote-chat/historyNotification';
import type { GuiEvent } from '../../../../shared/conversation/types';

afterEach(() => vi.useRealTimers());
const fragment = (delta: string): GuiEvent => ({ method: 'item/agentMessage/delta',
  params: { threadId: 'chat', turnId: 'turn', itemId: 'answer', delta } });

it('coalesces a burst of tokens in order and flushes before a snapshot or completion', async () => {
  vi.useFakeTimers();
  const send = vi.fn();
  const stream = new EventStream(send);
  for (let index = 0; index < 1000; index++) stream.receive(fragment('a'));
  expect(send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(40);
  expect(send).toHaveBeenCalledExactlyOnceWith(fragment('a'.repeat(1000)));
  stream.receive(fragment('b'));
  stream.flush();
  expect(send).toHaveBeenLastCalledWith(fragment('b'));
  stream.receive(fragment('c'));
  const completed: GuiEvent = { method: 'turn/completed', params: { threadId: 'chat' } };
  stream.receive(completed);
  expect(send.mock.calls.slice(-2)).toEqual([[fragment('c')], [completed]]);
  stream.close();
  expect(vi.getTimerCount()).toBe(0);
});

it('forwards live content but omits repeated turn and thread history from boundary events', () => {
  expect(historyNotification(fragment('live'))).toEqual(fragment('live'));
  const turn = { id: 'turn', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: 'large body' }] };
  expect(historyNotification({ method: 'turn/completed', params: { threadId: 'chat', turn } }).params.turn?.items)
    .toEqual([]);
  expect(JSON.stringify(historyNotification({ method: 'thread/started', params: {
    thread: { id: 'chat', preview: '', cwd: '', updatedAt: 1, turns: [turn] },
  } }))).not.toContain('large body');
});
