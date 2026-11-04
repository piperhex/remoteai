// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { emptyGrouping, memberGroup, type Grouping } from '../../../../../shared/chat/groups/model';
import { mutateGrouping, readGrouping } from '../../../../../shared/chat/groups/mutations';
import { flattenGroupingTree, groupingTree } from '../../../../../shared/chat/groups/tree';
import { createGuiGroups, loadGrouping } from './groupActions';
import { initialState } from './preferences';
import { SidebarBridge } from './sidebarBridge';
import { guiApi } from '../../../../../shared/conversation/api';

const seeded = (): Grouping => ({ ...emptyGrouping(), groups: [
  { id: 'work', name: 'Work', parentId: null }, { id: 'child', name: 'Child', parentId: 'work' },
  { id: 'other', name: 'Other', parentId: null },
] });
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it('rejects cycles, duplicate names and malformed remote mutations without changing state', () => {
  const state = seeded();
  const before = JSON.stringify(state);
  expect(() => mutateGrouping(state, { action: 'edit', id: 'work', name: 'Work', parentId: 'child' })).toThrow();
  expect(() => mutateGrouping(state, { action: 'create', group: { id: 'duplicate', name: 'Work', parentId: null } }))
    .toThrow('client.groups.duplicateName');
  for (const mutation of [null, { action: 'assign', targets: null },
    { action: 'create', group: { id: 'x', name: 'X', parentId: null, icon: 'javascript:alert(1)' } },
    { action: 'assign', targets: [{ kind: 'file', id: '/path' }], groupId: 'work' }]) {
    expect(() => mutateGrouping(state, mutation)).toThrow();
  }
  expect(JSON.stringify(state)).toBe(before);
});

it('moves entire projects, overrides individual conversations and flattens nested collapse without duplicates', () => {
  const state = { ...seeded(), projects: { '/project': 'child' }, threads: { two: 'other', three: null } };
  const tree = groupingTree([{ cwd: '/project', label: 'Project', data: [{ id: 'one' }, { id: 'two' }, { id: 'three' }] }], state);
  const all = flattenGroupingTree(tree, new Set());
  expect(all.map(row => [row.id, row.depth, row.data.map(thread => thread.id)])).toEqual([
    ['group:work', 0, []], ['group:child', 1, []], ['project:/project', 2, ['one']],
    ['group:other', 0, ['two']], ['ungrouped', 0, ['three']],
  ]);
  expect(flattenGroupingTree(tree, new Set(['group:work'])).flatMap(row => row.data.map(thread => thread.id)))
    .toEqual(['two', 'three']);
  expect(memberGroup(state, { kind: 'thread', id: 'three', cwd: '/project', title: '' })).toBeNull();
});

it('deleting a group preserves children, projects and conversations at its parent', () => {
  const state = { ...seeded(), projects: { '/project': 'work' }, threads: { one: 'work', two: 'child' } };
  const result = mutateGrouping(state, { action: 'delete', id: 'work' });
  expect(result.groups.find(group => group.id === 'child')?.parentId).toBeNull();
  expect(result.projects).toEqual({ '/project': null });
  expect(result.threads).toEqual({ one: null, two: 'child' });
  expect(readGrouping({ ...state, groups: [{ id: 'cycle', name: 'Cycle', parentId: 'cycle' }] })).toEqual(emptyGrouping());
  const collision = { ...state, groups: [...state.groups, { id: 'duplicate', name: 'Child', parentId: null }] };
  expect(() => mutateGrouping(collision, { action: 'delete', id: 'work' })).toThrow('client.groups.duplicateName');
  expect(readGrouping(collision)).toEqual(collision);
});

it('removing conversation groups restores the original project, including legacy ungrouped entries', () => {
  const state = { ...seeded(), projects: { '/project': 'child' },
    threads: { one: 'other', two: null, untouched: 'other' } };
  const restored = mutateGrouping(state, { action: 'assign', groupId: null,
    targets: [{ kind: 'thread', id: 'one' }, { kind: 'thread', id: 'two' }] });
  expect(restored.threads).toEqual({ untouched: 'other' });
  expect(restored.projects).toEqual(state.projects);
  expect(state.threads).toEqual({ one: 'other', two: null, untouched: 'other' });
  const tree = flattenGroupingTree(groupingTree([
    { cwd: '/project', label: 'Project', data: [{ id: 'one' }, { id: 'two' }] },
  ], readGrouping(JSON.parse(JSON.stringify(restored)))), new Set());
  expect(tree.find(row => row.id === 'project:/project')).toMatchObject({ depth: 2,
    data: [{ id: 'one' }, { id: 'two' }] });
  expect(tree.some(row => row.id === 'ungrouped')).toBe(false);
  expect(memberGroup(restored, { kind: 'thread', id: 'one', cwd: '/project', title: '' })).toBe('child');
});

it('removing a group from a conversation without a project keeps it projectless', () => {
  const thread = { id: 'loose', cwd: '' };
  const state = { ...seeded(), threads: { loose: 'work' } };
  const restored = mutateGrouping(state, { action: 'assign', groupId: null,
    targets: [{ kind: 'thread', id: thread.id }] });
  const tree = flattenGroupingTree(groupingTree([{ id: 'recent', cwd: '', label: 'Recent', data: [thread] }], restored),
    new Set());
  expect(tree.find(row => row.id === 'recent')?.data).toEqual([{ id: 'loose', cwd: '' }]);
  expect(restored.projects).toEqual({});
  expect(tree.some(row => row.cwd || row.id === 'ungrouped')).toBe(false);
  expect(mutateGrouping(restored, { action: 'assign', groupId: null,
    targets: [{ kind: 'thread', id: thread.id }] })).toEqual(restored);
});

it('batch removal returns projects to the root and threads to their own projects', () => {
  const state = { ...seeded(), projects: { '/project': 'child', '/other': 'work' },
    threads: { one: 'other', two: 'child' } };
  const restored = mutateGrouping(state, { action: 'assign', groupId: null,
    targets: [{ kind: 'project', id: '/project' }, { kind: 'thread', id: 'one' }, { kind: 'thread', id: 'two' }] });
  const tree = flattenGroupingTree(groupingTree([
    { cwd: '/project', label: 'Project', data: [{ id: 'one' }] },
    { cwd: '/other', label: 'Other', data: [{ id: 'two' }] },
  ], restored), new Set());
  expect(restored.projects).toEqual({ '/other': 'work' });
  expect(tree.find(row => row.cwd === '/project')).toMatchObject({ depth: 0, data: [{ id: 'one' }] });
  expect(tree.find(row => row.cwd === '/other')).toMatchObject({ depth: 1, data: [{ id: 'two' }] });
});

it('persists before publication, reloads changes and broadcasts group-only updates', async () => {
  let state = { ...initialState(), grouping: seeded() };
  let changed = () => {};
  const bridge = new SidebarBridge();
  bridge.attach({ getSnapshot: () => state, subscribe: listener => { changed = listener; return () => true; },
    readState: { markRemoteRead: vi.fn() } as never });
  const service = createGuiGroups({ snapshot: () => state, patch: patch => { state = { ...state, ...patch }; changed(); } });
  const published = vi.fn(); bridge.subscribe(published);
  await service.mutate({ action: 'assign', targets: [{ kind: 'project', id: '/project' }], groupId: 'work' });
  expect(loadGrouping()).toEqual(state.grouping);
  expect(published).toHaveBeenCalledOnce();
  expect(bridge.snapshot().grouping?.projects).toEqual({ '/project': 'work' });
  await service.mutate({ action: 'assign', targets: [{ kind: 'thread', id: 'one' }], groupId: 'child' });
  await service.mutate({ action: 'assign', targets: [{ kind: 'thread', id: 'one' }], groupId: null });
  expect(loadGrouping().threads).toEqual({});
  expect(bridge.snapshot().grouping?.threads).toEqual({});
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  await expect(service.mutate({ action: 'delete', id: 'work' })).rejects.toThrow('client.groups.saveFailed');
  expect(state.grouping.groups).toHaveLength(3);
});

it('management loads older pages and archived chats, with effective project paths', async () => {
  const thread = (id: string) => ({ id, cwd: '/project', preview: id, updatedAt: 1 });
  vi.spyOn(guiApi, 'request').mockImplementation(async request => {
    if (request.operation !== 'list') throw new Error('unexpected');
    return (request.archived ? { data: [thread('archived')] } : request.cursor
      ? { data: [thread('older')] } : { data: [thread('recent')], nextCursor: 'page2' }) as never;
  });
  const state = { ...initialState(), projectOverrides: { older: '/moved' } };
  const rows = await createGuiGroups({ snapshot: () => state, patch: vi.fn() }).members();
  expect(rows.filter(row => row.kind === 'thread').map(row => [row.id, row.cwd, row.archived]))
    .toEqual([['recent', '/project', false], ['older', '/moved', false], ['archived', '/project', true]]);
});
