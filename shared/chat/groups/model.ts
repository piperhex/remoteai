export const GROUPS_OPERATION = 'guiGroups';
export const GROUPS_UNSUPPORTED_ERROR = 'client.errors.updateRemoteAiOnYourComputerAndTryAgain';
export const GROUP_ICON_SIZE = 128;
export const GROUP_NAME_LIMIT = 80;
export const GROUP_LIMIT = 200;
export const GROUP_ICON_LIMIT = 100_000;

export interface ChatGroup { id: string; name: string; parentId: string | null; icon?: string }
export interface Grouping {
  groups: ChatGroup[];
  projects: Record<string, string | null>;
  threads: Record<string, string | null>;
}
export interface GroupTarget { kind: 'project' | 'thread'; id: string }
export interface GroupMember extends GroupTarget { title: string; cwd: string; archived?: boolean }
export type GroupMutation =
  | { action: 'create'; group: ChatGroup }
  | { action: 'edit'; id: string; name: string; parentId: string | null; icon?: string }
  | { action: 'delete'; id: string }
  | { action: 'assign'; targets: GroupTarget[]; groupId: string | null };
export interface GroupClient {
  mutate: (mutation: GroupMutation) => Promise<void>;
  members: () => Promise<GroupMember[]>;
}
export const emptyGrouping = (): Grouping => ({ groups: [], projects: {}, threads: {} });
export const EMPTY_GROUPING = emptyGrouping();

export function groupPath(groups: ChatGroup[], id: string): string {
  const names: string[] = [];
  const visited = new Set<string>();
  let group = groups.find(entry => entry.id === id);
  while (group && !visited.has(group.id)) {
    visited.add(group.id);
    names.unshift(group.name);
    group = groups.find(entry => entry.id === group?.parentId);
  }
  return names.join(' / ');
}

export function groupOptions(groups: ChatGroup[], exclude?: string) {
  return groups.filter(group => !exclude || !isDescendant(groups, group.id, exclude))
    .map(group => ({ value: group.id, label: groupPath(groups, group.id), icon: group.icon }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function isDescendant(groups: ChatGroup[], id: string | null, ancestor: string): boolean {
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    if (id === ancestor) return true;
    visited.add(id);
    id = groups.find(group => group.id === id)?.parentId ?? null;
  }
  return false;
}

export function memberGroup(grouping: Grouping, member: GroupMember): string | null {
  if (member.kind === 'project') return grouping.projects[member.id] ?? null;
  return Object.hasOwn(grouping.threads, member.id)
    ? grouping.threads[member.id] : grouping.projects[member.cwd] ?? null;
}
