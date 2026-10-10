// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { conversation, reduceEvent } from './events';
import { initialState } from './preferences';
import type { GuiState, Thread } from './types';

it('shows tool-created conversations and supplements without switching the selection or settings', () => {
  const current: Thread = { id: 'current', cwd: '', preview: 'current', updatedAt: 1, turns: [] };
  const target: Thread = { id: 'target', cwd: '', preview: '', updatedAt: 2, turns: [] };
  let state: GuiState = { ...initialState(), selected: current.id, threads: [current],
    conversations: { [current.id]: conversation(current) } };
  const settings = state.settings;
  state = reduceEvent(state, { method: 'thread/resumed', params: { thread: target } });
  state = reduceEvent(state, { method: 'turn/started', params: { threadId: target.id,
    turn: { id: 'turn', status: 'inProgress', items: [] } } });
  for (const [id, text] of [['first', '测试'], ['supplement', '补充要求']]) {
    state = reduceEvent(state, { method: 'item/completed', params: { threadId: target.id, turnId: 'turn',
      item: { id, type: 'userMessage', content: [{ type: 'text', text }] } } });
  }
  expect(state.selected).toBe(current.id);
  expect(state.settings).toBe(settings);
  expect(state.threads.map((thread) => thread.id)).toEqual([target.id, current.id]);
  expect(state.conversations.target.activeTurn).toBe('turn');
  expect(state.conversations.target.turns[0].items.map((item) => item.id)).toEqual(['first', 'supplement']);
});
