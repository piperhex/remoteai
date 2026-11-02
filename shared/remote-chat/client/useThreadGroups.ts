import { useMemo, useState } from 'react';
import { previewThreads, THREAD_GROUP_PREVIEW_COUNT } from '../../chat/threadGroupPreview';
import { projectThreadGroups } from '../sidebar';
import type { ChatState } from './types';
import { groupingTree, flattenGroupingTree } from '../../chat/groups/tree';

function toggleProject(previous: Set<string>, cwd: string) {
  const next = new Set(previous);
  if (next.has(cwd)) next.delete(cwd);
  else next.add(cwd);
  return next;
}

export function useThreadGroups(state: ChatState) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const filtering = Boolean(state.search.trim());
  const groups = useMemo(() => flattenGroupingTree(
    groupingTree(projectThreadGroups(state.threads, state.sidebar), state.sidebar.grouping),
    filtering ? new Set() : collapsed).map((group) => {
    const showAll = filtering || expanded.has(group.id);
    const isCollapsed = !filtering && collapsed.has(group.id);
    const visibleThreads = showAll ? group.data : previewThreads(group.data, state.selected?.id ?? null);
    return { ...group, expanded: showAll, collapsed: isCollapsed,
      canToggle: !isCollapsed && !filtering && group.data.length > THREAD_GROUP_PREVIEW_COUNT,
      data: isCollapsed ? [] : visibleThreads };
  }), [state.threads, state.sidebar, state.selected?.id, filtering, expanded, collapsed]);
  const toggle = (cwd: string) => setExpanded(previous => toggleProject(previous, cwd));
  const toggleCollapse = (cwd: string) => {
    setCollapsed(previous => toggleProject(previous, cwd));
    setExpanded(previous => {
      const next = new Set(previous);
      next.delete(cwd);
      return next;
    });
  };
  return { groups, toggle, toggleCollapse };
}
