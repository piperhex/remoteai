import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

export interface WorkspaceTab {
  id: string;
  title: string;
  icon?: ReactNode;
  save?: () => void;
}

export interface WorkspaceTabs {
  entries: WorkspaceTab[];
  selected: string | null;
  closed: ReadonlySet<string>;
  visible: boolean;
  content: HTMLDivElement | null;
  register: (tab: WorkspaceTab) => () => void;
  open: (id: string) => void;
  close: (id: string, order: string[]) => string | null;
  hide: () => void;
  rememberOpener: () => void;
}

export const workspaceTabId = {
  git: (cwd: string) => `git:${cwd}`,
  files: (cwd: string) => `files:${cwd}`,
};

/** Internal drawers stay within their owning conversation, including remote workspaces. */
export const WorkspaceDrawerContext = createContext<{
  active: boolean;
  /** Open content tabs remain active while the drawer is hidden or minimized. */
  hasOpenTabs: boolean;
  tabs: WorkspaceTabs;
} | null>(null);

/** Portals retain the caller's providers and mounted state while the shared drawer changes tabs. */
export function useWorkspaceDrawerTab({ tab, active, present = true, autoOpen = false }: {
  tab: WorkspaceTab; active: boolean; present?: boolean; autoOpen?: boolean;
}) {
  const workspace = useContext(WorkspaceDrawerContext);
  const register = workspace?.tabs.register;
  const open = workspace?.tabs.open;
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (present) return register?.(tab);
  }, [register, present, tab.id, tab.title, tab.icon, tab.save]);
  useEffect(() => {
    // Project tools open from their launch buttons; remounting a retained tab must not reveal the drawer.
    if (autoOpen && present && active && opened.current !== tab.id) {
      opened.current = tab.id; open?.(tab.id);
    }
  }, [open, present, active, autoOpen, tab.id]);
  return {
    host: workspace?.tabs.content,
    selected: workspace?.tabs.selected === tab.id,
    visible: Boolean(workspace?.tabs.visible && workspace.tabs.selected === tab.id),
    open: () => open?.(tab.id),
    hide: workspace?.tabs.hide,
  };
}
