import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatThreadList } from './ChatThreadList';
import { initialChatState, type ChatState, type Thread } from './types';
import type { ChatController } from './controller';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], slot: 0 }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: <T,>(compute: () => T) => compute(),
  useState: <T,>(initial: () => T) => {
    const slot = hooks.slot++;
    if (!(slot in hooks.states)) hooks.states[slot] = initial();
    return [hooks.states[slot], (update: (previous: T) => T) => {
      hooks.states[slot] = update(hooks.states[slot] as T);
    }];
  },

  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ Pressable: 'Pressable', SectionList: 'SectionList', Text: 'Text',
  View: 'View', ActivityIndicator: 'Spinner', StyleSheet: { create: <T,>(value: T) => value } }));
vi.mock('@expo/vector-icons/Feather', () => ({ default: 'Icon' }));
vi.mock('./useThreadListScroll', () => ({ useThreadListScroll: () => ({}) }));
beforeEach(() => { hooks.states = []; hooks.slot = 0; vi.stubGlobal('React', React); });
afterEach(() => vi.unstubAllGlobals());

function render(state: ChatState) {
  hooks.slot = 0;
  return ChatThreadList({ state, controller: {} as ChatController, select: vi.fn(), newChat: vi.fn(),
    openActions: vi.fn(), bottomInset: 0 }).props;
}
const ids = (group: { data: Thread[] }) => group.data.map(thread => thread.id);

it('shows pull-to-refresh progress only for an explicit refresh', () => {
  const state = { ...initialChatState(), ready: true, loading: true };
  expect(render(state).refreshing).toBe(false);
  expect(render({ ...state, listRefreshing: true }).refreshing).toBe(true);
  expect(render({ ...state, loading: false, listRefreshing: false }).refreshing).toBe(false);
});

it.each(['/project', ''])('moves running native rows to the front of %j and restores their positions', (cwd) => {
  const state = { ...initialChatState(), ready: true, threads: Array.from({ length: 7 }, (_, index) => ({
    id: `chat-${index}`, name: `聊天 ${index}`, preview: '', updatedAt: 7 - index, cwd,
  })) };
  expect(ids(render(state).sections[0])).toEqual(['chat-0', 'chat-1', 'chat-2', 'chat-3', 'chat-4']);
  state.sidebar = { ...state.sidebar, revision: 1, threads: {
    'chat-5': { cwd, title: '聊天 5', projectName: '', running: true },
    'chat-6': { cwd, title: '聊天 6', projectName: '', running: true },
  } };
  const active = render(state);
  expect(ids(active.sections[0])).toEqual(['chat-5', 'chat-6', 'chat-0', 'chat-1', 'chat-2']);
  active.renderSectionFooter({ section: active.sections[0] }).props.onPress();
  expect(ids(render(state).sections[0])).toEqual(['chat-5', 'chat-6', 'chat-0', 'chat-1', 'chat-2', 'chat-3', 'chat-4']);
  state.sidebar = { ...state.sidebar, revision: 2, threads: Object.fromEntries(
    Object.entries(state.sidebar.threads).map(([id, value]) => [id, { ...value, running: false }]),
  ) };
  expect(ids(render(state).sections[0])).toEqual(state.threads.map(thread => thread.id));
});
