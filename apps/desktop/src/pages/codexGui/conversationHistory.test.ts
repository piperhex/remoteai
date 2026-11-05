// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ConversationHistory } from './conversationHistory';
import { guiApi } from '../../../../../shared/conversation/api';
import { conversation, reduceEvent } from '../../../../../shared/conversation/events';
import { sliceHistory } from '../../../../../shared/remote-chat/historyPage';
import type { GuiState, Thread } from '../../../../../shared/conversation/types';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
const source: Thread = { id: 'chat', cwd: '', preview: '', updatedAt: 1,
  turns: [{ id: 'turn', status: 'completed', items: Array.from({ length: 35 }, (_, index) => ({
    id: `item-${index}`, type: 'agentMessage', text: `Message ${index}`,
  })) }] };
let state: GuiState;
let history: ConversationHistory;
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  state = { conversations: {}, approvals: [], threadReadState: {} } as unknown as GuiState;
  history = new ConversationHistory({ getSnapshot: () => state, patch: patch => { state = { ...state, ...patch }; },
    markRead: vi.fn(), loaded: vi.fn() });
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation !== 'read' || !request.window) throw new Error('Expected paged read');
    return sliceHistory(source, request.window);
  });
});
const ids = () => state.conversations.chat.turns.flatMap(turn => turn.items.map(item => item.id));

it('opens the newest page, expands without losing messages, and retains the cursor on reselect', async () => {
  await history.select('chat', () => true);
  expect(ids()).toHaveLength(10);
  for (const count of [20, 30, 35]) {
    await history.loadOlder('chat', () => true);
    expect(ids()).toHaveLength(count);
    expect(new Set(ids()).size).toBe(count);
  }
  expect(state.conversations.chat.historyPage?.hasMore).toBe(false);
  await history.select('chat', () => true);
  expect(ids()).toEqual(source.turns![0].items.map(item => item.id));
});

it('shares an in-flight older read and ignores it after switching away and back', async () => {
  await history.select('chat', () => true);
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let current = true;
  const first = history.loadOlder('chat', () => current);
  const second = history.loadOlder('chat', () => current);
  expect(first).toBe(second);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  current = false;
  finish(sliceHistory(source, { start: state.conversations.chat.historyPage?.start, older: true }));
  await first;
  expect(ids()).toHaveLength(10);
  await history.loadOlder('chat', () => true);
  expect(ids()).toHaveLength(20);
});

it('preserves a completed reply received while an older page is loading', async () => {
  await history.select('chat', () => true);
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const reading = history.loadOlder('chat', () => true);
  state = reduceEvent(state, { method: 'turn/completed', params: { threadId: 'chat',
    turn: { id: 'live', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: 'new answer' }] } } });
  finish(sliceHistory(source, { start: state.conversations.chat.historyPage?.start, older: true }));
  await reading;
  expect(ids()).toHaveLength(21);
  expect(ids().at(-1)).toBe('answer');
});

it('keeps visible history after failure and permits retry', async () => {
  await history.select('chat', () => true);
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error('read failed'));
  await expect(history.loadOlder('chat', () => true)).rejects.toThrow('read failed');
  expect(ids()).toHaveLength(10);
  await history.loadOlder('chat', () => true);
  expect(ids()).toHaveLength(20);
});

it('loads history when joining a running conversation and keeps its live tail', async () => {
  state.conversations.chat = conversation({ ...source, turns: [{ id: 'live', status: 'inProgress',
    items: [{ id: 'answer', type: 'agentMessage', text: 'working' }] }] });
  await history.select('chat', () => true);
  expect(ids()).toHaveLength(11);
  expect(state.conversations.chat.activeTurn).toBe('live');
  expect(state.conversations.chat.historyPage?.hasMore).toBe(true);
});
