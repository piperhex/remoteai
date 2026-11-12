import { expect, it } from 'vitest';
import { conversation, reduceConversation } from '../../../../shared/conversation/events';
import { updateThread } from '../../../../shared/remote-chat/client/events';
import { conversationEntries } from '../../../../shared/chat/turnPresentation';
import { activityTimeline } from '../../../../shared/chat/activityTimeline';
import { turnMessageGroups } from '../../../../shared/conversation/turnMessageGroups';
import { visibleTurnRequestErrors } from '../../../../shared/conversation/turnRequestErrors';
import { MODEL_CAPACITY_MESSAGE } from '../../../../shared/conversation/requestError';
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
