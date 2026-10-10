// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { SidebarBridge } from './sidebarBridge';
import { GuiReadState } from './threadReadState';
import { initialState, savePreferences } from './preferences';
import { saveProject } from './projectCatalog';
import type { GuiState, Thread } from './types';
import { projectThreadGroups } from '../../../../../shared/remote-chat/sidebar';

const thread: Thread = { id: 'one', cwd: 'F:/project', name: '第一项任务', preview: '', updatedAt: 1 };
beforeEach(() => localStorage.clear());

it('shares project overrides, running state and read receipts with the desktop in both directions', () => {
  let state = initialState();
  state.threads = [thread];
  state.projectOverrides.one = 'F:/renamed';
  state.threadReadState.one = { turnId: 'turn', unread: true };
  saveProject({ path: 'F:/renamed', name: '我的项目' });
  const listeners = new Set<() => void>();
  const host = { getSnapshot: () => state, patch: (patch: Partial<GuiState>) => {
    state = { ...state, ...patch }; listeners.forEach((listener) => listener());
  } };
  const readState = new GuiReadState(host);
  const bridge = new SidebarBridge();
  const detach = bridge.attach({ ...host, readState,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } });
  expect(bridge.snapshot().threads.one).toMatchObject({ projectName: '我的项目', cwd: 'F:/renamed', running: false });
  host.patch({ pins: ['one'] });
  expect(bridge.snapshot().pins).toEqual(['one']);
  host.patch({ pins: [] });
  expect(bridge.snapshot().pins).toEqual([]);
  bridge.markRead({ threadId: 'one', turnId: 'turn' });
  expect(state.threadReadState.one.unread).toBe(false);
  host.patch({ threadReadState: { one: { turnId: 'next', unread: true } } });
  bridge.markRead({ threadId: 'one', turnId: 'turn' });
  expect(state.threadReadState.one.unread).toBe(true);
  host.patch({ pendingRequest: { threadId: 'one' } as GuiState['pendingRequest'] });
  expect(bridge.snapshot().threads.one.running).toBe(true);
  readState.setViewing(true);
  host.patch({ selected: 'one' });
  readState.markRead('one');
  expect(bridge.snapshot().readState.one.unread).toBe(false);
  detach();
});

it('persists background completions while the PC chat page is closed and ignores duplicate completions', () => {
  const bridge = new SidebarBridge();
  bridge.observe([thread]);
  const event = { method: 'turn/completed', params: { threadId: 'one',
    turn: { id: 'turn', status: 'completed', items: [] } } };
  bridge.receive(event);
  expect(initialState().threadReadState.one.unread).toBe(true);
  bridge.markRead({ threadId: 'one', turnId: 'turn' });
  bridge.receive(event);
  expect(initialState().threadReadState.one.unread).toBe(false);
  const recreated = new SidebarBridge();
  expect(recreated.observe([thread]).readState.one.unread).toBe(false);
});

it('keeps a newer running notification ahead of a stale list response', () => {
  const bridge = new SidebarBridge();
  bridge.observe([thread]);
  const version = bridge.version();
  bridge.receive({ method: 'turn/started', params: { threadId: 'one',
    turn: { id: 'turn', status: 'inProgress', items: [] } } });
  expect(bridge.observe([{ ...thread, status: { type: 'idle' } }], version).threads.one.running).toBe(true);
});

it('publishes background title notifications and keeps them ahead of a stale list response', () => {
  const bridge = new SidebarBridge();
  bridge.observe([thread]);
  const version = bridge.version();
  bridge.receive({ method: 'thread/name/updated', params: { threadId: thread.id, threadName: '手机新标题' } });
  expect(bridge.snapshot().threads.one.title).toBe('手机新标题');
  expect(bridge.observe([thread], version).threads.one.title).toBe('手机新标题');
});

it('groups by full project path, including overrides, and leaves projectless chats together', () => {
  const state = initialState();
  state.projectOverrides.one = '';
  savePreferences(state);
  const threads = [thread, { ...thread, id: 'two', cwd: '' }, { ...thread, id: 'three', cwd: 'G:/project' }];
  const sidebar = new SidebarBridge().observe(threads);
  expect(projectThreadGroups(threads, sidebar).map((group) => [group.label, group.data.map((item) => item.id)]))
    .toEqual([['最近', ['one', 'two']], ['project', ['three']]]);
});
