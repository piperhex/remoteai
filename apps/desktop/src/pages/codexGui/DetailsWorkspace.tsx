import { useEffect, useId, useRef, type ReactNode } from "react";
import { FileDiff, FileSearch, Maximize2, Minimize2, Minus, PanelRightOpen, X } from "lucide-react";
import { DetailsContext } from "./detailsContext";
import { DiffDocument } from "./DiffDocument";
import { useDiffText } from "../../../../../shared/chat/diffText";
import { useDrawerResize } from "./useDrawerResize";
import { guiFontStyle, useGuiFontSize } from "./guiAppearance";
import { useDetailsPanel } from "./useDetailsPanel";
import { FilePreviewPanel } from "./filePreview/FilePreviewPanel";
import { WebsitePreview } from "./filePreview/WebsitePreview";
import styles from "./DetailsWorkspace.module.less";

const MIN_CHAT_WIDTH = 520;

export function DetailsWorkspace({ selected, active, children, enabled = true, className = '', contentClassName = '' }: {
  selected: string | null; active: boolean; children: ReactNode;
  enabled?: boolean; className?: string; contentClassName?: string;
}) {
  const t = useDiffText();
  const fontSize = useGuiFontSize();
  const host = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const panel = useDetailsPanel({ selected, active, enabled });
  const { entry, preview, viewId, expanded, visible, showingChanges } = panel;
  const resize = useDrawerResize(host);
  const docked = visible && !expanded && resize.available - resize.width >= MIN_CHAT_WIDTH;
  const width = expanded ? resize.available : resize.width;
  useEffect(() => { if (visible) closeButton.current?.focus(); }, [visible, viewId]);
  useEffect(() => { if (!visible || expanded) resize.cancel(); }, [visible, expanded, resize.cancel]);
  return <DetailsContext.Provider value={enabled ? panel.context : null}>
    <div ref={host} className={`${styles.host} ${className}`} data-dragging={resize.dragging || undefined}
      style={guiFontStyle(fontSize)}>
      <div className={`${styles.conversation} ${contentClassName}`} style={{ marginRight: docked ? width : 0 }}>
        {children}</div>
      {(entry || preview) && <aside hidden={!visible} id={panelId} data-details-panel
        data-website={preview?.kind === "website" || undefined}
        aria-label={t(showingChanges ? "文件更改详情" : "预览详情")} className={styles.drawer}
        style={{ width }} onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); panel.context.close(); }
        }}>
        {!expanded && <div className={styles.resizeHandle} role="separator" tabIndex={0}
          aria-label={t("调整详情抽屉宽度")} aria-orientation="vertical" aria-controls={panelId}
          aria-valuemin={resize.minimum} aria-valuemax={resize.maximum} aria-valuenow={width} {...resize.handle} />}
        <header className={styles.header}>
          <div className={styles.tabs} role="tablist" aria-label={t("侧栏内容")}>
            <button className={styles.tab} role="tab" aria-selected={showingChanges}
              onClick={panel.showChanges}><FileDiff size={16} />{t("文件更改")}</button>
            {preview && <button className={styles.tab} role="tab" aria-selected={!showingChanges}
              onClick={panel.showPreview}><FileSearch size={16} />{t("预览")}</button>}
          </div>
          <div className={styles.controls}>
            <button aria-label={t(expanded ? "还原抽屉宽度" : "展开详情抽屉")}
              onClick={() => panel.setExpanded(!expanded)}>
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
            <button aria-label={t("最小化详情抽屉")} onClick={panel.minimize}>
              <Minus size={16} /></button>
            <button ref={closeButton} aria-label={t("关闭详情抽屉")} onClick={panel.context.close}><X size={17} /></button>
          </div>
        </header>
        {entry && <div hidden={!showingChanges} key={`${entry.id}:${entry.filePath ?? ""}:${viewId}`}
          className={styles.content}>
          {!entry.files.length && <p className={styles.empty}>{t("暂无文件更改")}</p>}
          <DiffDocument files={entry.files} filePath={entry.filePath}
            title={entry.title} status={entry.status}
            initialOpen continuous />
        </div>}
        {preview && <div hidden={showingChanges} className={styles.preview}>
          {preview.kind === "file" ? <FilePreviewPanel key={preview.data.sessionId} data={preview.data}
            active={visible && !showingChanges} navigation={panel.navigation} />
            : <WebsitePreview key={preview.url} url={preview.url} active={visible && !showingChanges}
              resizing={resize.dragging} navigation={panel.navigation} />}
        </div>}
      </aside>}
      {(entry || preview) && panel.minimized && active && enabled &&
        <button className={styles.restore} onClick={panel.restore}>
          <PanelRightOpen size={16} />{t(showingChanges ? "恢复文件更改" : "恢复预览")}</button>}
    </div>
  </DetailsContext.Provider>;
}
