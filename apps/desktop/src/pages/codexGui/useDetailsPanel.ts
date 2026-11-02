import { uiText } from "../../i18n/uiText";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiffPanelEntry } from "./detailsContext";
import { usePreviewHistory } from "./filePreview/usePreviewHistory";
import type { WorkspaceTabs } from "../../../../../shared/chat/workspaceDrawer";
import { useManagedBrowserTabs } from './filePreview/useManagedBrowserTabs';

const EMPTY_CHANGES: DiffPanelEntry = { id: "conversation-changes", get title() { return uiText("client.chat.fileChanges.049e14"); }, files: [] };

export function useDetailsPanel({ selected, enabled, active, remoteFiles = false, drawer }: {
  selected: string | null; enabled: boolean; active: boolean; remoteFiles?: boolean; drawer: WorkspaceTabs;
}) {
  const [entry, setEntry] = useState<DiffPanelEntry | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [viewId, setViewId] = useState(0);
  const changes = useRef(EMPTY_CHANGES);
  const rememberOpener = drawer.rememberOpener;
  const openTab = drawer.open;
  const hide = drawer.hide;
  const showingChanges = drawer.selected === "changes";
  const previousTab = useRef(drawer.selected);
  const reveal = useCallback((diff: boolean) => {
    openTab(diff ? "changes" : "preview");
    if (diff) setViewId(value => value + 1);
  }, [openTab]);
  const revealPreview = useCallback(() => reveal(false), [reveal]);
  const { preview, websites, navigation, hasFileHistory, openFile, openRemoteFile, openWebsite,
    openManagedWebsite, cancel, reset }
    = usePreviewHistory({
    onOpen: rememberOpener, onNavigate: revealPreview,
  });
  const closeManagedWebsite = useCallback((id: string) => {
    if (websites.tabs.length === 1 && websites.tabs[0].id === id) hide();
    websites.remove(id);
  }, [websites.tabs, websites.remove, hide]);
  useManagedBrowserTabs({ threadId: selected, active: enabled && active,
    open: openManagedWebsite, close: closeManagedWebsite });
  const visible = drawer.visible && enabled
    && Boolean((showingChanges && entry) || (drawer.selected === "preview" && preview));
  const open = useCallback((next: DiffPanelEntry) => {
    cancel(); rememberOpener(); setEntry(next); reveal(true);
  }, [cancel, rememberOpener, reveal]);
  const update = useCallback((next: DiffPanelEntry) => {
    setEntry(current => current?.id === next.id ? { ...next,
      filePath: next.files.some(file => file.path === current.filePath) ? current.filePath : undefined } : current);
  }, []);
  const setConversationChanges = useCallback((next: DiffPanelEntry) => { changes.current = next; }, []);
  const close = useCallback(() => {
    cancel(); hide();
  }, [cancel, hide]);
  useEffect(() => {
    if (previousTab.current !== drawer.selected && drawer.selected !== "preview") cancel();
    previousTab.current = drawer.selected;
  }, [drawer.selected, cancel]);
  useLayoutEffect(() => {
    reset(); setEntry(null); setExpanded(false);
    return cancel;
  }, [selected, enabled, reset, cancel]);
  const context = useMemo(() => ({ open, update, close, openFile, openWebsite, setConversationChanges,
    openRemoteFile: remoteFiles ? openRemoteFile : undefined, visible, showingChanges }),
  [open, update, close, openFile, openRemoteFile, remoteFiles, openWebsite, setConversationChanges,
    visible, showingChanges]);
  return { context, entry, preview, websites, navigation, hasFileHistory, showingChanges, visible, viewId, expanded, setExpanded,
    showChanges: () => { if (!entry) setEntry(changes.current); cancel(); openTab("changes"); },
    showPreview: () => { cancel(); openTab("preview"); } };
}
