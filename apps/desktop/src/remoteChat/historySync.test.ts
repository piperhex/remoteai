import { expect, it } from 'vitest';
import { applyHistoryDelta, historyDelta, historyVersion } from '../../../../shared/remote-chat/historySync';
import type { Thread } from '../../../../shared/conversation/types';

const thread: Thread = { id: 'chat', preview: '', cwd: '', updatedAt: 1,
  turns: [{ id: 'turn', status: 'inProgress', items: [
    { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'already synchronized question' }] },
    { id: 'answer', type: 'agentMessage', text: 'already synchronized answer '.repeat(1000) },
  ] }] };

it('sends no message bodies on an unchanged poll or after a PC restart', () => {
  const delta = historyDelta(structuredClone(thread), historyVersion(thread));
  expect(delta.turns).toEqual([]);
  expect(JSON.stringify(delta)).not.toContain('already synchronized');
  expect(JSON.stringify(delta).length).toBeLessThan(200);
  expect(applyHistoryDelta(thread, delta)).toEqual(thread);
});

it('sends only the unseen streaming suffix and completion metadata', () => {
  const next = structuredClone(thread);
  next.turns![0].status = 'completed';
  next.turns![0].items[1].text += 'new suffix';
  const delta = historyDelta(next, historyVersion(thread));
  expect(JSON.stringify(delta)).not.toContain('already synchronized');
  expect(delta.turns[0].items).toEqual([{ id: 'answer',
    patch: { set: {}, remove: [], append: { text: 'new suffix' } } }]);
  expect(applyHistoryDelta(thread, delta)).toEqual(next);
});

it('recovers missed turns, edits, deletions, reordering and removed fields', () => {
  const next = structuredClone(thread);
  next.name = 'renamed';
  next.turns![0].items = [{ id: 'answer', type: 'agentMessage', status: 'completed', text: 'edited' }];
  next.turns!.unshift({ id: 'missed', status: 'completed', items: [{ id: 'new', type: 'agentMessage', text: 'new' }] });
  expect(applyHistoryDelta(thread, historyDelta(next, historyVersion(thread)))).toEqual(next);
  const empty = { ...next, turns: [] };
  expect(applyHistoryDelta(next, historyDelta(empty, historyVersion(next)))).toEqual(empty);
});

it('does not append a suffix to a different prefix of the same length', () => {
  const next = structuredClone(thread);
  next.turns![0].items[1].text = 'different answer '.repeat(2000);
  expect(applyHistoryDelta(thread, historyDelta(next, historyVersion(thread)))).toEqual(next);
});
