import { type ChatGroup, type Grouping } from './model';
import { mutateGrouping } from './mutations';

export interface GroupManagerRow extends ChatGroup {
  depth: number;
  hasChildren: boolean;
  projectCount: number;
}

/** Keep ancestors in search results so matching subgroups retain their context. */
export function groupManagerRows(grouping: Grouping, query: string, collapsed: ReadonlySet<string>) {
  const { groups } = grouping;
  const byId = new Map(groups.map(group => [group.id, group]));
  const children = new Map<string | null, ChatGroup[]>();
  const counts = new Map<string, number>();
  const matches = new Set<string>();
  const search = query.trim().toLocaleLowerCase();
  const ancestors = (id: string | null) => {
    const result: string[] = [];
    while (id && byId.has(id) && !result.includes(id)) {
      result.push(id);
      id = byId.get(id)!.parentId;
    }
    return result;
  };
  for (const group of groups) {
    const parent = group.parentId && byId.has(group.parentId) ? group.parentId : null;
    children.set(parent, [...children.get(parent) ?? [], group]);
    if (!search || group.name.toLocaleLowerCase().includes(search)) {
      ancestors(group.id).forEach(id => matches.add(id));
    }
  }
  Object.values(grouping.projects).forEach(id => ancestors(id).forEach(ancestor =>
    counts.set(ancestor, (counts.get(ancestor) ?? 0) + 1)));
  const rows: GroupManagerRow[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const group of children.get(parent) ?? []) {
      if (!matches.has(group.id)) continue;
      rows.push({ ...group, depth, hasChildren: children.has(group.id), projectCount: counts.get(group.id) ?? 0 });
      if (search || !collapsed.has(group.id)) visit(group.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

/** Validate the complete plan first; delete children before their selected parents. */
export function planGroupDeletion(grouping: Grouping, selected: ChatGroup[]): string[] {
  const ids = new Set(selected.map(group => group.id));
  const rows = groupManagerRows(grouping, '', new Set()).filter(group => ids.has(group.id))
    .sort((left, right) => right.depth - left.depth);
  rows.reduce((state, group) => mutateGrouping(state, { action: 'delete', id: group.id }), grouping);
  return rows.map(group => group.id);
}
