import type { GroupMember, GroupMembersQuery } from '../../../shared/chat/groups/model';
import type { Thread } from '../../../shared/conversation/types';

export interface FixtureThread extends Thread { archived?: boolean }
export const groupRequests = { pages: [] as GroupMembersQuery[], full: 0 };
Object.assign(window, { groupRequests });

export function membersFixture(options: GroupMembersQuery & {
  projects: { path: string; name: string }[]; projectOverrides: Record<string, string>;
}, threads: FixtureThread[]) {
  groupRequests.pages.push({ page: options.page, pageSize: options.pageSize, search: options.search });
  const conversations: GroupMember[] = threads.map(thread => ({ kind: 'thread', id: thread.id,
    title: thread.name || thread.preview || thread.id, cwd: options.projectOverrides[thread.id] ?? thread.cwd,
    archived: thread.archived }));
  const paths = new Set([...options.projects.map(project => project.path), ...conversations.map(thread => thread.cwd)]);
  const projects: GroupMember[] = [...paths].filter(Boolean).sort((left, right) => right.localeCompare(left))
    .map(path => ({ kind: 'project', id: path, cwd: path,
      title: options.projects.find(project => project.path === path)?.name ?? path.split('/').pop()! }));
  const rows = [...projects, ...conversations].filter(row => `${row.title} ${row.cwd}`.toLowerCase()
    .includes(options.search.toLowerCase()));
  const page = Math.min(options.page, Math.max(1, Math.ceil(rows.length / options.pageSize)));
  return { data: rows.slice((page - 1) * options.pageSize, page * options.pageSize),
    total: rows.length, page, pageSize: options.pageSize };
}

export function manyThreads(): FixtureThread[] {
  return Array.from({ length: 235 }, (_, index) => ({ id: `history-${index}`, name: `历史对话 ${index}`,
    cwd: `/workspace/project-${index % 5}`, preview: 'A saved conversation', updatedAt: 235 - index,
    archived: index >= 220 }));
}
