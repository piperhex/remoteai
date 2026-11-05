import { useLayoutEffect, useMemo, useRef } from 'react';
import type { TurnMessageGroup } from './turnMessageGroups';

/** A page can prepend to a process group; keep its mounted details and reading anchor. */
export function useStableProcessGroups(groups: TurnMessageGroup[]) {
  const committed = useRef(new Set<string>());
  const stable = useMemo(() => groups.map(group => {
    if (group.type !== 'work') return group;
    const anchor = group.items.find(item => committed.current.has(item.id));
    return anchor ? { ...group, key: anchor.id } : group;
  }), [groups]);
  useLayoutEffect(() => {
    committed.current = new Set(stable.filter(group => group.type === 'work').map(group => group.key));
  }, [stable]);
  return stable;
}
