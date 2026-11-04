// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { ConversationCache } from './conversationCache';
import { initialState } from './preferences';
import type { Conversation, GuiState } from '../../../../../shared/conversation/types';

const conversation = (id: string, length = 2_000): Conversation => ({
  thread: { id, cwd: '', preview: '', updatedAt: 1 }, activeTurn: null, error: '', tokens: 0,
  turns: [{ id: 'turn', status: 'completed', items: [{ id: 'output', type: 'agentMessage', text: '文'.repeat(length) }] }],
});
beforeEach(() => localStorage.clear());

it('evicts by retained bytes and LRU access, including a single oversized history', () => {
  const cache = new ConversationCache(10_000);
  const state = initialState();
  state.conversations = { a: conversation('a'), b: conversation('b') };
  expect(Object.keys(cache.trim(state))).toEqual(['a', 'b']);
  cache.touch('a');
  state.conversations.c = conversation('c');
  state.conversations = cache.trim(state);
  expect(Object.keys(state.conversations)).toEqual(['a', 'c']);
  state.conversations.huge = conversation('huge', 100_000);
  expect(cache.trim(state)).toEqual({});
});

it('keeps selected, running, queued, approving and in-flight histories above the budget', () => {
  const cache = new ConversationCache(0);
  const state = initialState();
  const ids = ['selected', 'running', 'queued', 'approval', 'pending', 'compacting', 'leased', 'echo', 'retry'];
  state.conversations = Object.fromEntries(ids.map(id => [id, conversation(id)]));
  state.selected = 'selected';
  state.conversations.running.activeTurn = 'turn';
  state.conversations.echo.turns[0].items[0] = { id: 'sent', type: 'userMessage', localEcho: true };
  state.queued.queued = [{ id: 'q', text: 'next', images: [], skills: [], model: '', effort: '', access: 'read-only' }];
  state.approvals = [{ id: 1, method: 'approval', params: { threadId: 'approval' } }];
  state.pendingRequest = { threadId: 'pending', startedAtMs: 1 };
  state.compacting = 'compacting';
  const release = cache.retain('leased');
  const releaseOther = cache.retain('leased');
  release(); release();
  expect(Object.keys(cache.trim(state, ['retry']))).toEqual(ids);
  releaseOther();
  expect(cache.trim(state, ['retry']).leased).toBeUndefined();
  const idle: GuiState = { ...initialState(), conversations: { completed: conversation('completed') } };
  expect(cache.trim(idle)).toEqual({});
});

it('reuses size estimates without traversing unchanged completed output on every patch', () => {
  const cache = new ConversationCache();
  const state = initialState();
  const value = conversation('history');
  let reads = 0;
  Object.defineProperty(value.turns[0].items[0], 'text', { enumerable: true, get: () => { reads++; return 'large'; } });
  state.conversations.history = value;
  cache.trim(state);
  expect(reads).toBeGreaterThan(0);
  const first = reads;
  for (let index = 0; index < 100; index++) cache.trim({ ...state, loading: Boolean(index % 2) });
  expect(reads).toBe(first);
});
