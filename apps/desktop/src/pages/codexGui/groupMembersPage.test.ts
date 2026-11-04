// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { readMembersPage, readMembersQuery } from '../../../../../shared/chat/groups/memberPaging';
import { createGuiGroups } from './groupActions';
import { initialState } from './preferences';
import { guiApi } from '../../../../../shared/conversation/api';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it('requests one bounded metadata page, including saved aliases and effective paths, without fetching all threads', async () => {
  localStorage.setItem('codex-switch:gui-projects', JSON.stringify([{ path: '/saved', name: 'Alias' }]));
  const state = { ...initialState(), projects: ['/recent'], projectOverrides: { older: '/moved' } };
  state.grouping.projects['/grouped'] = 'group';
  const response = { data: [], total: 200, page: 3, pageSize: 50 };
  const request = vi.spyOn(guiApi, 'request').mockResolvedValue(response);
  const groups = createGuiGroups({ snapshot: () => state, patch: vi.fn() });
  await expect(groups.membersPage!({ page: 3, pageSize: 50, search: ' older ' })).resolves.toEqual(response);
  expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'groupMembersPage', page: 3, pageSize: 50,
    search: 'older', projectOverrides: { older: '/moved' }, projects: [
      { path: '/recent', name: 'recent' }, { path: '/saved', name: 'Alias' }, { path: '/grouped', name: 'grouped' },
    ] });
});

it('rejects malformed paging and a pre-paging host response', () => {
  for (const query of [null, {}, { page: 0, pageSize: 20, search: '' }, { page: 1, pageSize: 10_000, search: '' },
    { page: 1.2, pageSize: 20, search: '' }, { page: 1, pageSize: 20, search: 'x'.repeat(1001) }]) {
    expect(() => readMembersQuery(query)).toThrow();
  }
  expect(() => readMembersPage({ revision: 1 })).toThrow('updateRemoteAiOnYourComputerAndTryAgain');
  expect(() => readMembersPage({ data: [], total: -1, page: 1, pageSize: 20 })).toThrow();
});
