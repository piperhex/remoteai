import { describe, expect, it } from 'vitest';
import { localRunningConversations, remoteRunningConversations } from
  '../../../../../shared/conversation/runningConversationEntries';
import { initialChatState } from '../../../../../shared/remote-chat/client/types';
import { emptySidebar } from '../../../../../shared/remote-chat/sidebar';
import { initialState } from './preferences';
import { conversation } from '../../../../../shared/conversation/events';
import type { Thread } from '../../../../../shared/conversation/types';

const thread = (id: string, active = true): Thread => ({ id, name: id, preview: '', cwd: '/project',
  updatedAt: 1, status: { type: active ? 'active' : 'idle' } });
const sidebar = { ...emptySidebar(), threads: {
  hidden: { title: 'Outside current page', cwd: '/hidden', projectName: 'Hidden project', running: true },
  completed: { title: 'Completed', cwd: '/project', projectName: 'Project', running: false },
} };

describe('running conversation entries', () => {
  it('includes all local activity outside search/archived pages without duplicating cached conversations', () => {
    const live = thread('live');
    const value = { ...conversation(live), activeTurn: 'turn' };
    const state = { ...initialState(), archived: true, search: 'unrelated', threads: [live, thread('idle', false)],
      conversations: { live: value }, projectOverrides: { live: '/overridden' } };
    expect(localRunningConversations(state, sidebar).map(({ id, cwd }) => [id, cwd]))
      .toEqual([['hidden', '/hidden'], ['live', '/overridden']]);
  });

  it('includes a pending local request and removes a finished conversation despite stale cached status', () => {
    const state = { ...initialState(), threads: [thread('pending', false), thread('completed')],
      pendingRequest: { threadId: 'pending', startedAtMs: 1 } };
    expect(localRunningConversations(state, sidebar).map(entry => entry.id)).toEqual(['hidden', 'pending']);
    expect(localRunningConversations({ ...state, pendingRequest: undefined }, emptySidebar()))
      .toEqual([expect.objectContaining({ id: 'completed' })]);
  });

  it('keeps remote entries beyond pagination and uses the host completion status', () => {
    const state = { ...initialChatState(), archived: true, search: 'unrelated', sidebar,
      threads: [thread('completed'), thread('live')], selected: thread('live'),
      approvals: [{ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'hidden' } }] };
    expect(remoteRunningConversations(state)).toEqual([
      expect.objectContaining({ id: 'hidden', needsInput: true }),
      expect.objectContaining({ id: 'live', needsInput: false }),
    ]);
  });

  it('does not truncate at five and hides when all work has finished', () => {
    expect(remoteRunningConversations({ ...initialChatState(), threads:
      Array.from({ length: 9 }, (_, index) => thread(String(index))) })).toHaveLength(9);
    expect(remoteRunningConversations({ ...initialChatState(), threads: [thread('done', false)] })).toEqual([]);
  });
});
