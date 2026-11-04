import { mutateGrouping, readGrouping } from '../../../../../shared/chat/groups/mutations';
import { type GroupClient, type Grouping, type GroupMember } from '../../../../../shared/chat/groups/model';
import type { GuiState, ListResponse, Thread } from '../../../../../shared/conversation/types';
import { guiApi } from '../../../../../shared/conversation/api';
import { readProjects, projectName } from '../../../../../shared/conversation/projectCatalog';
import { readMembersPage, readMembersQuery } from '../../../../../shared/chat/groups/memberPaging';

const STORAGE_KEY = 'codex-switch:gui-custom-groups';

export function loadGrouping() {
  try { return readGrouping(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')); }
  catch { return readGrouping(undefined); }
}

function saveGrouping(grouping: Grouping) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(grouping)); }
  catch { throw new Error('client.groups.saveFailed'); }
}

export function forgetGroupedThread(grouping: Grouping, id: string): Grouping {
  if (!Object.hasOwn(grouping.threads, id)) return grouping;
  const threads = { ...grouping.threads };
  delete threads[id];
  const next = { ...grouping, threads };
  saveGrouping(next);
  return next;
}

export function forgetGroupedProject(grouping: Grouping, path: string): Grouping {
  if (!Object.hasOwn(grouping.projects, path)) return grouping;
  const projects = { ...grouping.projects };
  delete projects[path];
  const next = { ...grouping, projects };
  saveGrouping(next);
  return next;
}

async function allThreads(archived: boolean): Promise<Thread[]> {
  const threads: Thread[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const response = await guiApi.request<ListResponse<Thread>>({ operation: 'list', archived, cursor });
    threads.push(...response.data);
    cursor = response.nextCursor || undefined;
    if (cursor && seen.has(cursor)) throw new Error('client.groups.loadFailed');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return threads;
}

export function createGuiGroups(host: { snapshot: () => GuiState; patch: (patch: Partial<GuiState>) => void }): GroupClient {
  return {
    membersPage: async query => {
      const state = host.snapshot();
      const saved = readProjects();
      const paths = new Set([...state.projects, ...saved.map(project => project.path),
        ...Object.keys(state.grouping.projects)]);
      const projects = [...paths].filter(Boolean).map(path => ({ path, name: projectName(path) }));
      return readMembersPage(await guiApi.request({ operation: 'groupMembersPage', ...readMembersQuery(query),
        projects, projectOverrides: state.projectOverrides }));
    },
    mutate: async mutation => {
      const grouping = mutateGrouping(host.snapshot().grouping, mutation);
      saveGrouping(grouping);
      host.patch({ grouping });
    },
    members: async () => {
      const [recent, archived] = await Promise.all([allThreads(false), allThreads(true)]);
      const state = host.snapshot();
      const threads = new Map<string, GroupMember>();
      const add = (thread: Thread, isArchived: boolean) => threads.set(thread.id, { kind: 'thread', id: thread.id,
        title: thread.name || thread.preview || thread.id,
        cwd: state.projectOverrides[thread.id] ?? thread.cwd, archived: isArchived });
      recent.forEach(thread => add(thread, false));
      archived.forEach(thread => add(thread, true));
      const paths = new Set([...state.projects, ...readProjects().map(project => project.path),
        ...Object.keys(state.grouping.projects), ...[...threads.values()].map(thread => thread.cwd)]);
      const projects: GroupMember[] = [...paths].filter(Boolean)
        .map(path => ({ kind: 'project', id: path, title: projectName(path), cwd: path }));
      return [...projects, ...threads.values()];
    },
  };
}
