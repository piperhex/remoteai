import { EMPTY_GROUPING, type Grouping } from './model';

export interface ProjectSection<T> { id?: string; cwd: string; label: string; data: T[]; pinned?: boolean }
export interface GroupSection<T> extends ProjectSection<T> {
  id: string; kind: 'group' | 'project'; icon?: string; depth: number;
}
interface Node<T> { section: GroupSection<T>; children: Node<T>[] }

/** Custom groups own projects and explicit conversation placements; every conversation appears once. */
export function groupingTree<T extends { id: string }>(input: ProjectSection<T>[], grouping = EMPTY_GROUPING) {
  const sections = [...input];
  Object.keys(grouping.projects).forEach(cwd => {
    if (cwd && !sections.some(section => section.cwd === cwd)) {
      sections.push({ cwd, label: cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd, data: [] });
    }
  });
  const roots: Node<T>[] = [];
  const nodes = new Map(grouping.groups.map(group => [group.id, { section: {
    id: `group:${group.id}`, kind: 'group' as const, cwd: '', label: group.name,
    icon: group.icon, depth: 0, data: [] as T[],
  }, children: [] as Node<T>[] }]));
  const destination = (id: string | null | undefined) => id ? nodes.get(id) : undefined;
  for (const group of grouping.groups) {
    const node = nodes.get(group.id)!;
    (destination(group.parentId)?.children ?? roots).push(node);
  }
  const loose: T[] = [];
  for (const section of sections) {
    const data = section.data.filter(thread => {
      if (!Object.hasOwn(grouping.threads, thread.id)) return true;
      const target = destination(grouping.threads[thread.id]);
      (target?.section.data ?? loose).push(thread);
      return false;
    });
    // Keep assigned project headings visible even when every conversation was moved separately.
    if (!data.length && !Object.hasOwn(grouping.projects, section.cwd)) continue;
    const node: Node<T> = { section: { ...section, data, kind: 'project',
      id: section.id ?? `project:${section.cwd}`, depth: 0 }, children: [] };
    (destination(grouping.projects[section.cwd])?.children ?? roots).push(node);
  }
  if (loose.length) roots.push({ section: { id: 'ungrouped', kind: 'project', cwd: '', label: '',
    data: loose, depth: 0 }, children: [] });
  return roots;
}

export function flattenGroupingTree<T>(nodes: Node<T>[], collapsed: ReadonlySet<string>, depth = 0): GroupSection<T>[] {
  return nodes.flatMap(node => [{ ...node.section, depth },
    ...(collapsed.has(node.section.id) ? [] : flattenGroupingTree(node.children, collapsed, depth + 1))]);
}
