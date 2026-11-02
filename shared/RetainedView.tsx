import { createContext, memo, useContext, useEffect, useState, type ReactNode } from 'react';

const ViewActivity = createContext(true);
export const useViewActive = () => useContext(ViewActivity);

/** Mount on first entry and ignore hidden parent updates, except scope changes needed for identity cleanup. */
export const RetainedView = memo(function RetainedView({ active, children, retain = true }: {
  active: boolean; children: ReactNode; retain?: boolean; scope?: string;
}) {
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  if (!active && (!visited || !retain)) return null;
  return <ViewActivity.Provider value={active}>{children}</ViewActivity.Provider>;
}, (previous, next) => !previous.active && !next.active
  && previous.retain === next.retain && previous.scope === next.scope);
