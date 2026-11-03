import { expect, it } from 'vitest';
import { groupManagerRows, planGroupDeletion } from '../../../../../shared/chat/groups/managerRows';
import { mutateGrouping } from '../../../../../shared/chat/groups/mutations';
import type { Grouping } from '../../../../../shared/chat/groups/model';

const grouping: Grouping = {
  groups: [{ id: 'child', name: 'Design', parentId: 'work' }, { id: 'work', name: 'Work', parentId: null },
    { id: 'deep', name: 'Icons', parentId: 'child' }, { id: 'study', name: 'Study', parentId: null }],
  projects: { '/a': 'child', '/b': 'work', '/c': 'deep', '/loose': null },
  threads: { one: 'work', two: 'child' },
};

it('orders parents before children and counts projects across subgroups without counting conversations', () => {
  expect(groupManagerRows(grouping, '', new Set()).map(row => [row.id, row.depth, row.projectCount])).toEqual([
    ['work', 0, 3], ['child', 1, 2], ['deep', 2, 1], ['study', 0, 0],
  ]);
});

it('search reveals matching descendants and their ancestors even under collapsed groups', () => {
  const collapsed = new Set(['work']);
  expect(groupManagerRows(grouping, '', collapsed).map(row => row.id)).toEqual(['work', 'study']);
  expect(groupManagerRows(grouping, ' ICONS ', collapsed).map(row => row.id)).toEqual(['work', 'child', 'deep']);
  expect(groupManagerRows(grouping, 'missing', collapsed)).toEqual([]);
});

it('validates batch deletion before any writes and removes selected descendants first', () => {
  const ids = planGroupDeletion(grouping, grouping.groups.filter(group => group.id !== 'study'));
  expect(ids).toEqual(['deep', 'child', 'work']);
  const result = ids.reduce((state, id) => mutateGrouping(state, { action: 'delete', id }), grouping);
  expect(result.groups.map(group => group.id)).toEqual(['study']);
  expect(result.projects).toEqual({ '/a': null, '/b': null, '/c': null, '/loose': null });
  expect(result.threads).toEqual({ one: null, two: null });
  expect(grouping.groups).toHaveLength(4);
  expect(planGroupDeletion(result, grouping.groups)).toEqual(['study']);
});

it('rejects a plan that would promote duplicate names while preserving its input', () => {
  const state = { ...grouping, groups: [...grouping.groups, { id: 'duplicate', name: 'Design', parentId: null }] };
  const before = JSON.stringify(state);
  expect(() => planGroupDeletion(state, [state.groups[1]])).toThrow('client.groups.duplicateName');
  expect(JSON.stringify(state)).toBe(before);
});
