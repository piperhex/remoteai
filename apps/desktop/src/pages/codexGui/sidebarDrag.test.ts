// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { acceptsSidebarDrop } from '../../../../../shared/chat/groups/SidebarDrag';
import { emptyGrouping } from '../../../../../shared/chat/groups/model';

const grouping = { ...emptyGrouping(), groups: [{ id: 'group', name: 'Group', parentId: null }],
  projects: { '/old': 'group' }, threads: { grouped: 'group' } };
const base = { grouping, threadCwds: { plain: '/old', grouped: '/old' }, canMoveThread: () => true };

it('accepts conversations and projects into existing groups, but ignores an unchanged explicit placement', () => {
  const destination = { kind: 'group' as const, id: 'group' };
  expect(acceptsSidebarDrop({ ...base, source: { kind: 'thread', id: 'plain' }, destination })).toBe(true);
  expect(acceptsSidebarDrop({ ...base, source: { kind: 'thread', id: 'grouped' }, destination })).toBe(false);
  expect(acceptsSidebarDrop({ ...base, source: { kind: 'project', id: '/new' }, destination })).toBe(true);
  expect(acceptsSidebarDrop({ ...base, source: { kind: 'project', id: '/old' }, destination })).toBe(false);
  expect(acceptsSidebarDrop({ ...base, source: { kind: 'thread', id: 'plain' },
    destination: { kind: 'group', id: 'deleted' } })).toBe(false);
});

it('moves only idle conversations into projects and permits returning a grouped chat to its own project', () => {
  const destination = { kind: 'project' as const, id: '/old' };
  expect(acceptsSidebarDrop({ ...base, source: { kind: 'thread', id: 'plain' }, destination })).toBe(false);
  expect(acceptsSidebarDrop({ ...base, source: { kind: 'thread', id: 'grouped' }, destination })).toBe(true);
  expect(acceptsSidebarDrop({ ...base, source: { kind: 'project', id: '/new' }, destination })).toBe(false);
  expect(acceptsSidebarDrop({ ...base, source: { kind: 'thread', id: 'plain' },
    destination: { kind: 'project', id: '/new' } })).toBe(true);
  expect(acceptsSidebarDrop({ ...base, canMoveThread: () => false, source: { kind: 'thread', id: 'grouped' },
    destination })).toBe(false);
});
