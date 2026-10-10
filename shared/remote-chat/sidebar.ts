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
  revision: number;
  pins?: string[];
  threads: Record<string, SidebarThread>;
  readState: Record<string, ThreadReadReceipt>;
}
export const emptySidebar = (): SidebarSnapshot => ({ revision: -1, threads: {}, readState: {} });

export function threadPresentation(thread: Thread, sidebar: SidebarSnapshot, translate = (text: string) => text) {
  const entry = sidebar.threads[thread.id];
  const cwd = entry?.cwd ?? thread.cwd;
  return {
    cwd, title: entry?.title || thread.name || thread.preview || translate('新聊天'),
    projectName: entry?.projectName || cwd?.split(/[\\/]/).filter(Boolean).at(-1) || translate('最近'),
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
  }));
}
