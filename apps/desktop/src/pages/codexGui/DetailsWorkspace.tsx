import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { ConfigProvider } from 'antd';
import { WorkspaceDrawerContext } from "../../../../../shared/chat/workspaceDrawer";
import { useWorkspaceDrawer } from "../../../../../shared/chat/useWorkspaceDrawer";
import { WorkspaceDrawerTabs } from "../../../../../shared/chat/WorkspaceDrawerTabs";
import { FileDiff, FileSearch, Maximize2, Minimize2, Minus, PanelRightOpen, X } from "lucide-react";
import { DetailsContext } from "./detailsContext";
import { DiffDocument } from "./DiffDocument";
import { useDiffText } from "../../../../../shared/chat/diffText";
import { useDrawerResize } from "./useDrawerResize";
import { guiFontStyle, useGuiFontSize } from "./guiAppearance";
import { useDetailsPanel } from "./useDetailsPanel";
import { FilePreviewPanel } from "./filePreview/FilePreviewPanel";
import { WebsitePreview } from "./filePreview/WebsitePreview";
import type { FilePreviewTarget } from "./filePreview/usePreviewHistory";
import type { PreviewNavigationState } from "./filePreview/PreviewNavigation";
import styles from "./DetailsWorkspace.module.less";

const MIN_CHAT_WIDTH = 520;

export interface RemoteFilePreviewProps {
  target: FilePreviewTarget; active: boolean; navigation: PreviewNavigationState;
}

export function DetailsWorkspace({ selected, active, children, enabled = true, className = '', contentClassName = '',
  renderRemoteFile }: {
  selected: string | null; active: boolean; children: ReactNode;
  enabled?: boolean; className?: string; contentClassName?: string;
  renderRemoteFile?: (props: RemoteFilePreviewProps) => ReactNode;
}) {
  const t = useDiffText();
  const fontSize = useGuiFontSize();
  const host = useRef<HTMLDivElement>(null);
  const drawer = useWorkspaceDrawer(active);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const panel = useDetailsPanel({ selected, enabled, active, remoteFiles: Boolean(renderRemoteFile), drawer: drawer.tabs });
  const { entry, preview, viewId, expanded, showingChanges } = panel;
  const showingPreview = drawer.tabs.selected === "preview";
  const tool = drawer.tabs.entries.find(tab => tab.id === drawer.tabs.selected);
  const visible = drawer.tabs.visible
    && Boolean(tool || (enabled && ((showingChanges && entry) || (showingPreview && preview))));
  const hasTabs = Boolean(entry || preview || drawer.tabs.entries.length);
  const tabs = [
    ...(enabled ? [{ id: 'changes', title: t('client.chat.fileChanges.049e14'), icon: <FileDiff size={16} /> }] : []),
    ...(preview ? [{ id: 'preview', title: t('client.chat.preview'), icon: <FileSearch size={16} /> }] : []),
    ...drawer.tabs.entries,
  ].filter(tab => !drawer.tabs.closed.has(tab.id));
  const hasOpenTabs = Boolean(enabled && ((entry && !drawer.tabs.closed.has('changes'))
    || (preview && !drawer.tabs.closed.has('preview'))))
    || drawer.tabs.entries.some(tab => !drawer.tabs.closed.has(tab.id));
  const workspace = useMemo(() => ({ active, tabs: drawer.tabs, hasOpenTabs }), [active, drawer.tabs, hasOpenTabs]);
  const label = tool?.title ?? t(showingChanges ? "client.chat.fileChangeDetails" : "client.desktopGuiExtras.previewDetails");
  const resize = useDrawerResize(host);
  const docked = visible && !expanded && resize.available - resize.width >= MIN_CHAT_WIDTH;
  const width = expanded ? resize.available : resize.width;
  useEffect(() => { if (visible) closeButton.current?.focus(); }, [visible]);
  useEffect(() => { if (!visible || expanded) resize.cancel(); }, [visible, expanded, resize.cancel]);
  return <ConfigProvider theme={{ token: { fontSize } }}>
    <DetailsContext.Provider value={enabled ? panel.context : null}>
    <WorkspaceDrawerContext.Provider value={workspace}>
    <div ref={host} className={`${styles.host} ${className}`} data-dragging={resize.dragging || undefined}
      style={guiFontStyle(fontSize)}>
        <div className={`${styles.conversation} ${contentClassName}`}
          style={{ marginRight: docked ? width : 0 }}>{children}</div>
      <div className={styles.drawerHost} data-workspace-drawers>
      {hasTabs && <aside hidden={!visible} id={panelId} data-details-panel role="dialog"
        data-website={(showingPreview && preview?.kind === "website") || undefined}
        aria-label={label} className={styles.drawer}
        style={{ width }} onKeyDown={(event) => {
          if (tool?.save && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
            event.preventDefault(); event.stopPropagation(); tool.save();
          }
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.stopPropagation(); panel.context.close();
          }
        }}>
        {!expanded && <div className={styles.resizeHandle} role="separator" tabIndex={0}
          aria-label={t("client.chat.resizeDetailsPanel")} aria-orientation="vertical" aria-controls={panelId}
          aria-valuemin={resize.minimum} aria-valuemax={resize.maximum} aria-valuenow={width} {...resize.handle} />}
        <header className={styles.header}>
          <WorkspaceDrawerTabs tabs={tabs} selected={drawer.tabs.selected} visible={visible}
            choose={id => {
              if (id === 'changes') panel.showChanges();
              else if (id === 'preview') panel.showPreview();
              else drawer.tabs.open(id);
            }} close={id => {
              const next = drawer.tabs.close(id, tabs.map(tab => tab.id));
              if (id === drawer.tabs.selected && next === 'changes') panel.showChanges();
            }} />
          <div className={styles.controls}>
            <button aria-label={t(expanded ? "client.chat.restorePanelWidth" : "client.chat.expandDetailsPanel")}
              onClick={() => panel.setExpanded(!expanded)}>
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
            <button aria-label={t("client.chat.minimizeDetailsPanel")} onClick={() => { panel.context.close(); drawer.minimize(); }}>
              <Minus size={16} /></button>
            <button ref={closeButton} aria-label={t("client.chat.closeDetailsPanel")} onClick={panel.context.close}><X size={17} /></button>
          </div>
        </header>
        {entry && <div hidden={!showingChanges} key={`${entry.id}:${entry.filePath ?? ""}:${viewId}`}
          className={styles.content}>
          {!entry.files.length && <p className={styles.empty}>{t("client.chat.noFileChangesYet")}</p>}
          <DiffDocument files={entry.files} filePath={entry.filePath}
            title={entry.title} status={entry.status}
            initialOpen continuous />
        </div>}
        {preview && preview.kind !== 'website' && <div hidden={!showingPreview} className={styles.preview}>
          {preview.kind === "file" && <FilePreviewPanel key={preview.data.sessionId} data={preview.data}
            active={visible && showingPreview} navigation={panel.navigation} />}
          {preview.kind === "remoteFile" && renderRemoteFile?.({ target: preview.file,
            active: visible && showingPreview, navigation: panel.navigation })}
        </div>}
        {panel.websites.tabs.length > 0 && <div hidden={!showingPreview || preview?.kind !== 'website'}
          className={styles.preview}>
          <WebsitePreview browser={panel.websites} active={active && visible && showingPreview && preview?.kind === 'website'}
            resizing={resize.dragging} navigation={panel.hasFileHistory ? panel.navigation : undefined} expanded={expanded}
            toggleExpanded={() => panel.setExpanded(!expanded)} onClose={panel.context.close} />
        </div>}
        <div ref={drawer.setContent} hidden={!tool} className={styles.toolContent} />
      </aside>}
      </div>
      {hasTabs && drawer.minimized && active &&
        <button className={styles.restore} onClick={drawer.restore}>
          <PanelRightOpen size={16} />{tool ? tool.title
            : t(showingChanges ? "client.chat.restoreFileChanges" : "client.desktopGuiExtras.restorePreview")}</button>}
    </div>
    </WorkspaceDrawerContext.Provider>
  </DetailsContext.Provider></ConfigProvider>;
}
