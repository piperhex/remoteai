import { defaultText } from '../localization/messages';
import type { Thread } from './client/types';
import { prioritizeRunningThreads } from '../chat/threadOrder';

export const SIDEBAR_EVENT = 'chat/sidebar/updated';
export interface ThreadReadReceipt { turnId: string; unread: boolean }
export interface SidebarThread {
  cwd: string;
  projectName: string;
  title: string;
  running: boolean;
}
export interface SidebarSnapshot {
  grouping?: import('../chat/groups/model').Grouping;
  revision: number;
  pins?: string[];
  pinnedProjects?: string[];
  threads: Record<string, SidebarThread>;
  readState: Record<string, ThreadReadReceipt>;
}
export const emptySidebar = (): SidebarSnapshot => ({ revision: -1, threads: {}, readState: {} });

export function threadPresentation(thread: Thread, sidebar: SidebarSnapshot, translate = defaultText) {
  const entry = sidebar.threads[thread.id];
  const cwd = entry?.cwd ?? thread.cwd;
  return {
    cwd, title: entry?.title || thread.name || thread.preview || translate("client.chat.newChat"),
    projectName: entry?.projectName || cwd?.split(/[\\/]/).filter(Boolean).at(-1) || translate("client.chat.recent"),
    running: entry?.running ?? (thread.status?.type === 'active'
      || thread.turns?.some((turn) => turn.status === 'inProgress') === true),
    unread: sidebar.readState[thread.id]?.unread ?? false,
  };
}

export function projectThreadGroups(threads: Thread[], sidebar: SidebarSnapshot) {
  const groups = new Map<string, { cwd: string; label: string; data: Thread[] }>();
  for (const thread of threads) {
    const { cwd, projectName } = threadPresentation(thread, sidebar);
    const group = groups.get(cwd) ?? { cwd, label: projectName, data: [] };
    group.data.push(thread);
    groups.set(cwd, group);
  }
  return [...groups.values()].map(group => ({ ...group,
    data: prioritizeRunningThreads(group.data, thread => threadPresentation(thread, sidebar).running)
      .sort((left, right) => Number(Boolean(sidebar.pins?.includes(right.id)))
        - Number(Boolean(sidebar.pins?.includes(left.id)))),
  })).sort((left, right) => Number(Boolean(sidebar.pinnedProjects?.includes(right.cwd)))
    - Number(Boolean(sidebar.pinnedProjects?.includes(left.cwd))));
}
