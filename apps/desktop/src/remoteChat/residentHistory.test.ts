import { expect, it } from 'vitest';
import { HISTORY_CONTENT_CHARS, HISTORY_ENTRY_LIMIT, TOOL_PREVIEW_CHARS, historyChars } from '../../../../shared/chat/historyBudget';
import { residentHistory, residentPage } from '../../../../shared/remote-chat/client/residentHistory';
import { applyChatEvent, updateThread } from '../../../../shared/remote-chat/client/events';
import { initialChatState } from '../../../../shared/remote-chat/client/types';
import type { GuiEvent, Thread } from '../../../../shared/conversation/types';

const thread: Thread = { id: 'chat', cwd: '', preview: '', updatedAt: 0, turns: [
  { id: 'turn', status: 'inProgress', items: [] },
] };

it('replaces cumulative command output with an exact detail reference while preserving original host data', () => {
  const delta: GuiEvent = { method: 'item/commandExecution/outputDelta', params: {
    threadId: thread.id, turnId: 'turn', itemId: 'cmd', delta: 'x'.repeat(16 * 1024),
  } };
  let state = { ...initialChatState(), selected: thread };
  for (let index = 0; index < 1024; index++) state = { ...state, selected: applyChatEvent(state, delta).selected! };
  expect(state.selected.turns![0].items[0]).toMatchObject({ detailsRef: { threadId: 'chat', turnId: 'turn', itemId: 'cmd' } });
  expect(historyChars(state.selected)).toBeLessThan(TOOL_PREVIEW_CHARS);
  const host = updateThread(updateThread(thread, delta), delta);
  expect(host.turns![0].items[0].aggregatedOutput).toHaveLength(2 * delta.params.delta!.length);
});

it('bounds both ends of an oversized turn and keeps the exact body address of a single oversized reply', () => {
  const text = 'A'.repeat(16 * 1024 * 1024);
  const turns = [{ ...thread.turns![0], diff: text, items: Array.from({ length: 1010 }, (_, i) =>
    ({ id: String(i), type: 'agentMessage', text: i === 1009 ? text : String(i) })) }];
  const history = { ...thread, turns };
  const recent = residentHistory(history);
  expect(recent.thread.turns![0].items).toHaveLength(HISTORY_ENTRY_LIMIT);
  expect(residentPage(recent.thread, true).start?.itemId).toBe(String(1010 - HISTORY_ENTRY_LIMIT));
  const item = recent.thread.turns![0].items.at(-1)!;
  expect(item).toMatchObject({ deferredBody: true, detailsRef: { threadId: 'chat', turnId: 'turn', itemId: '1009' } });
  expect(item.text!.length).toBeLessThan(text.length);
  expect(historyChars(recent.thread)).toBeLessThan(HISTORY_CONTENT_CHARS);
  const previous = residentHistory(history, true);
  expect(previous.thread.turns![0].items[0].id).toBe('0');
  expect(previous.cut).toBe(true);
});

it('keeps the message cursor across a long run of empty lifecycle turns', () => {
  const empty = Array.from({ length: HISTORY_ENTRY_LIMIT + 10 }, (_, i) => ({ id: String(i), status: 'completed', items: [] }));
  const history = residentHistory({ ...thread, turns: [
    { ...thread.turns![0], items: [{ id: 'message', type: 'agentMessage' }] }, ...empty,
  ] });
  expect(residentPage(history.thread, true).start?.itemId).toBe('message');
  expect(history.thread.turns?.at(-1)?.id).toBe(empty.at(-1)?.id);
});
