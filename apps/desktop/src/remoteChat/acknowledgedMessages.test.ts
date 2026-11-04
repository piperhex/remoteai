import { expect, it } from 'vitest';
import { acknowledgedEvents } from '../../../../shared/chat/acknowledgedMessages';
import { updateThread } from '../../../../shared/remote-chat/client/events';
import type { Item, Thread, Turn } from '../../../../shared/conversation/types';

it('reuses scans of immutable historical turns while preserving ordinals and neighbouring anchors', () => {
  let reads = 0;
  const history: Turn = { id: 'old', status: 'completed', get items() { reads++; return []; } };
  const items: Item[] = [{ id: 'first', type: 'userMessage' }, { id: 'tool', type: 'commandExecution' },
    { id: 'echo', type: 'userMessage', localEcho: true }, { id: 'answer', type: 'agentMessage' }];
  const thread: Thread = { id: 'chat', cwd: '', preview: '', updatedAt: 1,
    turns: [history, { id: 'live', status: 'inProgress', items }] };
  expect(acknowledgedEvents(thread)[0].params).toMatchObject({ userMessageIndex: 1,
    beforeItemId: 'answer', afterItemId: 'tool', threadId: 'chat', turnId: 'live' });
  const first = reads;
  for (let index = 0; index < 100; index++) {
    const turn = { ...thread.turns![1], items: [...items, { id: `later-${index}`, type: 'agentMessage' }] };
    expect(acknowledgedEvents({ ...thread, turns: [history, turn] })).toHaveLength(1);
  }
  expect(reads).toBe(first);
  const persisted = { ...thread.turns![1], items: items.map(item => ({ ...item, localEcho: false })) };
  expect(acknowledgedEvents({ ...thread, turns: [history, persisted] })).toEqual([]);
});

it('restores an interrupted first turn from a receipt without resuming generation', () => {
  const empty: Thread = { id: 'chat', cwd: '', preview: '', updatedAt: 1, turns: [] };
  const turn: Turn = { id: 'first', status: 'interrupted', startedAt: 1, completedAt: 2, durationMs: 1000,
    items: [{ id: 'sent-first', type: 'userMessage', localEcho: true, content: [{ type: 'text', text: 'Hello' }] }] };
  const restored = acknowledgedEvents({ ...empty, turns: [turn] }).reduce(updateThread, empty);
  expect(restored.turns).toEqual([turn]);
});

it('keeps a newer stop when a running receipt arrives late', () => {
  const turn: Turn = { id: 'first', status: 'inProgress', items: [
    { id: 'sent-first', type: 'userMessage', localEcho: true, content: [{ type: 'text', text: 'Hello' }] },
  ] };
  const thread: Thread = { id: 'chat', cwd: '', preview: '', updatedAt: 1, turns: [turn] };
  const stopped: Thread = { ...thread, turns: [{ ...turn, status: 'interrupted', items: [] }] };
  const restored = acknowledgedEvents(thread).reduce(updateThread, stopped);
  expect(restored.turns![0]).toMatchObject({ status: 'interrupted', items: turn.items });
});
