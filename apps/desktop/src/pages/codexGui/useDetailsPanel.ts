import { guiText } from "../../i18n/guiText";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffPanelEntry } from "./detailsContext";
import { usePreviewHistory } from "./filePreview/usePreviewHistory";

const EMPTY_CHANGES: DiffPanelEntry = { id: "conversation-changes", get title() { return guiText("文件更改"); }, files: [] };

export function useDetailsPanel({ selected, active, enabled }: {
  selected: string | null; active: boolean; enabled: boolean;
}) {
  const [entry, setEntry] = useState<DiffPanelEntry | null>(null);
  const [showingChanges, setShowingChanges] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [viewId, setViewId] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const changes = useRef(EMPTY_CHANGES);
  const rememberOpener = useCallback(() => {
    // Switching tabs inside the drawer must not replace the original conversation trigger.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && !focused.closest("[data-details-panel]")) opener.current = focused;
  }, []);
  const reveal = useCallback((diff: boolean) => {
    setShowingChanges(diff); setMinimized(false); setViewId(value => value + 1);
  }, []);
  const revealPreview = useCallback(() => reveal(false), [reveal]);
  const { preview, navigation, openFile, openWebsite, cancel, reset } = usePreviewHistory({
    onOpen: rememberOpener, onNavigate: revealPreview,
  });
  const visible = Boolean((entry || preview) && !minimized && active && enabled);
  const open = useCallback((next: DiffPanelEntry) => {
    cancel(); rememberOpener(); setEntry(next); reveal(true);
  }, [cancel, rememberOpener, reveal]);
  const update = useCallback((next: DiffPanelEntry) => {
    setEntry(current => current?.id === next.id ? { ...next,
      filePath: next.files.some(file => file.path === current.filePath) ? current.filePath : undefined } : current);
  }, []);
  const setConversationChanges = useCallback((next: DiffPanelEntry) => { changes.current = next; }, []);
  const close = useCallback(() => {
    cancel(); reset(); setEntry(null); setExpanded(false); opener.current?.focus();
  }, [cancel, reset]);
  useEffect(() => {
    reset(); setEntry(null); setMinimized(false); setExpanded(false);
    return cancel;
  }, [selected, enabled, reset, cancel]);
  const context = useMemo(() => ({ open, update, close, openFile, openWebsite, setConversationChanges,
    visible, showingChanges }), [open, update, close, openFile, openWebsite, setConversationChanges,
    visible, showingChanges]);
  return { context, entry, preview, navigation, showingChanges, visible, viewId, minimized, expanded, setExpanded,
    minimize: () => { setMinimized(true); opener.current?.focus(); },
    restore: () => setMinimized(false), showChanges: () => open(changes.current),
    showPreview: () => { cancel(); reveal(false); } };
}
