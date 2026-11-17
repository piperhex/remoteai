import { beforeEach, expect, it, vi } from 'vitest';
import { readGroupDirectoryPage } from './directoryGroups';
import { readMembersQuery } from '../../../../shared/chat/groups/memberPaging';

const mocks = vi.hoisted(() => ({ summaries: vi.fn(), state: { grouping: {
  groups: [{ id: 'group', name: 'Test', parentId: null }],
  threads: {} as Record<string, string | null>, projects: {} as Record<string, string | null>,
} }, members: vi.fn() }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: () => ({
  getSnapshot: () => mocks.state, groups: { membersPage: mocks.members },
}) }));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: mocks.summaries } }));
beforeEach(() => {
  mocks.summaries.mockReset(); mocks.members.mockReset();
  mocks.state.grouping.threads = {}; mocks.state.grouping.projects = {};
  mocks.summaries.mockImplementation(async ({ threadIds }: { threadIds: string[] }) => threadIds.map(id => ({
    id, cwd: '/project', name: id, preview: '', updatedAt: 1,
  })));
});

it('pages old explicit members and continues correctly when the previous anchor is removed', async () => {
  const ids = Array.from({ length: 1500 }, (_, index) => String(index).padStart(4, '0'));
  mocks.state.grouping.threads = Object.fromEntries(ids.map(id => [id, 'group']));
  const query = { groupId: 'group', archived: false, search: '' };
  const first = await readGroupDirectoryPage(query);
  expect(first.data).toHaveLength(50);
  expect(mocks.summaries.mock.calls[0][0].threadIds).toHaveLength(50);
  delete mocks.state.grouping.threads['0049'];
  const second = await readGroupDirectoryPage({ ...query, cursor: first.nextCursor });
  expect(second.data[0].id).toBe('0050');
  await expect(readGroupDirectoryPage({ ...query, archived: true, cursor: first.nextCursor })).rejects.toThrow();
});

it('uses supported bounded index pages for inherited project membership', async () => {
  mocks.state.grouping.projects['/project'] = 'group';
  mocks.members.mockImplementation(async (input: unknown) => {
    const query = readMembersQuery(input);
    return { ...query, total: 2, data: [
      { kind: 'thread', id: 'old', title: 'Old', cwd: '/project', archived: false },
      { kind: 'thread', id: 'other', title: 'Other', cwd: '/other', archived: false },
    ] };
  });
  const page = await readGroupDirectoryPage({ groupId: 'group', archived: false, search: '' });
  expect(page.data.map(row => row.id)).toEqual(['old']);
  expect(page.nextCursor).toBeNull();
});
