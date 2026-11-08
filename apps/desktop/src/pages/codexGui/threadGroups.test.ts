// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { initialState } from './preferences';
import { threadGroups } from './threadGroups';
import type { GuiState, Thread } from '../../../../../shared/conversation/types';

const thread = (id: string, cwd = '/project'): Thread => ({ id, cwd, preview: id, updatedAt: 1 });
beforeEach(() => localStorage.clear());

it('keeps project and pinned groups in place while promoting parallel replies stably within each group', () => {
  const state = { ...initialState(), pinnedProjects: ['/other'], pins: ['pinned-idle', 'pinned-running'], threads: [
    thread('idle'), thread('recent-idle', ''), thread('pinned-idle'), thread('first'), thread('second'),
    thread('other', '/other'), thread('recent-running', ''), thread('pinned-running'),
  ] };
  const original = state.threads.map(entry => entry.id);
  const running = new Set(['first', 'second', 'recent-running', 'pinned-running']);
  state.threads = state.threads.map(entry => ({ ...entry, status: { type: running.has(entry.id) ? 'active' : 'idle' } }));
  const groups = threadGroups(state);
  expect(groups.map(group => group.id)).toEqual(['pinned', 'project:/other', 'project:/project', 'project:']);
  expect(groups.map(group => group.threads.map(entry => entry.id))).toEqual([
    ['pinned-running', 'pinned-idle'], ['other'], ['first', 'second', 'idle'], ['recent-running', 'recent-idle'],
  ]);
  expect(state.threads.map(entry => entry.id)).toEqual(original);
  state.threads = state.threads.map(entry => ({ ...entry, status: { type: 'idle' } }));
  expect(threadGroups(state).map(group => group.threads.map(entry => entry.id))).toEqual([
    ['pinned-idle', 'pinned-running'], ['other'], ['idle', 'first', 'second'], ['recent-idle', 'recent-running'],
  ]);
});

it('orders each project by last activity while pending replies and pinned groups retain priority', () => {
  const threads = [
    { ...thread('older-created'), updatedAt: 50 },
    { ...thread('newer-created'), updatedAt: 20 },
    { ...thread('pending'), updatedAt: 1 },
    { ...thread('tie'), updatedAt: 20 },
    { ...thread('other', '/other'), updatedAt: 100 },
    { ...thread('pinned-old'), updatedAt: 2 },
    { ...thread('pinned-recent'), updatedAt: 30 },
  ];
  const state: GuiState = { ...initialState(), threads, pins: ['pinned-old', 'pinned-recent'],
    pendingRequest: { threadId: 'pending', startedAtMs: 1 } };
  const groups = threadGroups(state);
  expect(groups.map(group => group.threads.map(entry => entry.id))).toEqual([
    ['pinned-recent', 'pinned-old'], ['pending', 'older-created', 'newer-created', 'tie'], ['other'],
  ]);
  expect(state.threads).toBe(threads);
  state.pendingRequest = undefined;
  state.threads = threads.map(entry => entry.id === 'pending' ? { ...entry, updatedAt: 60 } : entry);
  expect(threadGroups(state)[1].threads.map(entry => entry.id))
    .toEqual(['pending', 'older-created', 'newer-created', 'tie']);
});
