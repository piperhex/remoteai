import { expect, it } from 'vitest';
import { conversation, reduceConversation } from '../../../../shared/conversation/events';
import { updateThread } from '../../../../shared/remote-chat/client/events';
import { conversationEntries } from '../../../../shared/chat/turnPresentation';
import { activityTimeline } from '../../../../shared/chat/activityTimeline';
import { turnMessageGroups } from '../../../../shared/conversation/turnMessageGroups';
import { visibleTurnRequestErrors } from '../../../../shared/conversation/turnRequestErrors';
import { MODEL_CAPACITY_MESSAGE } from '../../../../shared/conversation/requestError';
import { sliceHistory } from '../../../../shared/remote-chat/historyPage';
import { mergeHistory } from '../../../../shared/remote-chat/client/history';
import { residentHistory } from '../../../../shared/remote-chat/client/residentHistory';
import { HISTORY_ENTRY_LIMIT } from '../../../../shared/chat/historyBudget';
import type { GuiEvent, Thread, Turn } from '../../../../shared/conversation/types';

const source: Thread = { id: 'thread', cwd: '', preview: '', updatedAt: 1, turns: [
  { id: 'turn', status: 'inProgress', items: [
    { id: 'before', type: 'commandExecution', command: 'git status', status: 'completed' },
  ] },
] };
const failure: GuiEvent = { method: 'error', params: { threadId: source.id, turnId: 'turn', willRetry: true,
  error: { message: MODEL_CAPACITY_MESSAGE } } };
const itemEvent = (item: Turn['items'][number]): GuiEvent => ({ method: 'item/started',
  params: { threadId: source.id, turnId: 'turn', item } });

it('clears a retry when output continues in the same item and shows a subsequent interruption', () => {
  const partial = itemEvent({ id: 'answer', type: 'agentMessage', text: 'First' });
  let local = reduceConversation(reduceConversation(conversation(source), partial), failure);
  let remote = updateThread(updateThread(source, partial), failure);
  for (const [event, count] of [[partial, 1], [{ method: 'item/agentMessage/delta',
    params: { threadId: source.id, turnId: 'turn', itemId: 'answer', delta: ' and second' } }, 0],
    [failure, 1]] as const) {
    local = reduceConversation(local, event);
    remote = updateThread(remote, event);
    for (const turn of [local.turns[0], remote.turns![0]]) expect(visibleTurnRequestErrors(turn)).toHaveLength(count);
  }
});

it('resumes a cached reply from hosts that saved no output checkpoint', () => {
  const partial = updateThread(source, itemEvent({ id: 'answer', type: 'agentMessage', text: 'First' }));
  const turn = partial.turns![0];
  const retryError = { message: 'Interrupted' };
  const legacy = { id: 'retry', afterItemId: 'answer', itemCount: turn.items.length, willRetry: true };
  const delta = { method: 'item/agentMessage/delta', params: { turnId: turn.id, itemId: 'answer', delta: ' again' } };
  for (const requestErrors of [undefined, [legacy]]) {
    const cached = { ...source, turns: [{ ...turn, retryError, requestErrors }] };
    expect(visibleTurnRequestErrors(cached.turns[0])).toHaveLength(1);
    expect(visibleTurnRequestErrors(updateThread(cached, delta).turns![0])).toEqual([]);
    expect(visibleTurnRequestErrors(reduceConversation(conversation(cached), delta).turns[0])).toEqual([]);
  }
});

it('clears a remote retry when the next reasoning output is received only by a history read', () => {
  const reasoning = { id: 'reasoning', type: 'reasoning', summary: ['First'] };
  const pending = updateThread(updateThread(source, itemEvent(reasoning)), failure);
  const snapshot = updateThread(source, itemEvent({ ...reasoning, summary: ['First and second'] }));
  const merged = mergeHistory(snapshot, pending, pending).turns![0];
  expect(merged.items.at(-1)?.summary).toEqual(['First and second']);
  expect(visibleTurnRequestErrors(merged)).toEqual([]);
});

it('keeps a recovered retry hidden when its anchor leaves the remote history page or resident window', () => {
  const items = Array.from({ length: HISTORY_ENTRY_LIMIT + 1 }, (_, i) => ({
    id: String(i), type: 'agentMessage', text: String(i),
  }));
  const broken = updateThread({ ...source, turns: [{ ...source.turns![0], items }] }, failure);
  const after = items.map(item => ({ ...item, id: 'new-' + item.id }));
  const resumed = { ...broken, turns: [{ ...broken.turns![0], items: [...items, ...after] }] };
  expect(visibleTurnRequestErrors(resumed.turns[0])).toEqual([]);
  for (const projected of [sliceHistory(resumed).thread, residentHistory(resumed).thread]) {
    expect(projected.turns![0].items[0].id).toMatch(/^new-/);
    expect(visibleTurnRequestErrors(projected.turns![0])).toEqual([]);
    const cached = { ...projected, turns: [{ ...projected.turns![0], requestErrors: broken.turns![0].requestErrors }] };
    expect(visibleTurnRequestErrors(mergeHistory(projected, cached, cached).turns![0])).toEqual([]);
    const interrupted = updateThread(cached, failure);
    expect(visibleTurnRequestErrors(mergeHistory(projected, interrupted, cached).turns![0])).toHaveLength(1);
  }
});

it('keeps the pending capacity error on both clients until actual output resumes', () => {
  let local = reduceConversation(conversation(source), failure);
  let remote = updateThread(source, failure);
  for (const item of [{ id: 'reasoning', type: 'reasoning', summary: [] },
    { id: 'answer', type: 'agentMessage', phase: 'commentary', text: '' }] satisfies Turn['items']) {
    local = reduceConversation(local, itemEvent(item));
    remote = updateThread(remote, itemEvent(item));
    for (const turn of [local.turns[0], remote.turns![0]]) {
      expect(visibleTurnRequestErrors(turn)).toHaveLength(1);
      expect(turnMessageGroups(turn, { visibleItems: turn.items, followsInterruption: false })
        .map(group => group.type)).toEqual(['work', 'error']);
    }
  }
  const resumed = itemEvent({ id: 'answer', type: 'agentMessage', phase: 'commentary', text: 'Resumed' });
  local = reduceConversation(local, resumed);
  remote = updateThread(remote, resumed);
  expect(visibleTurnRequestErrors(local.turns[0])).toEqual([]);
  expect(visibleTurnRequestErrors(remote.turns![0])).toEqual([]);
});

it.each([true, false])('keeps failure boundaries outside work groups (expanded=%s)', inline => {
  let thread = updateThread(source, { ...failure, params: { ...failure.params, willRetry: false } });
  thread = updateThread(thread, itemEvent({ id: 'after', type: 'commandExecution', command: 'git diff' }));
  thread.turns![0].plan = [{ step: 'Review', status: 'pending' }];
  const turn = thread.turns![0];
  const timeline = activityTimeline(conversationEntries([turn], new Map([[turn.id, inline]])));
  expect(timeline.filter(entry => entry.kind !== 'process').map(entry => entry.kind))
    .toEqual(['work', 'error', 'work', 'summary']);
  const groups = turnMessageGroups(turn, { visibleItems: turn.items, followsInterruption: false });
  expect(groups.map(group => group.type)).toEqual(['work', 'error', 'work']);
  expect(timeline.find(entry => entry.kind === 'error')).toMatchObject({ error: { afterItemId: 'before' } });
});
