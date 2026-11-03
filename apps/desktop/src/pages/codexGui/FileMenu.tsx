import { uiText } from "../../i18n/uiText";
import type { ReactNode } from "react";
import { Dropdown, type MenuProps } from "antd";
import { ChevronRight, Copy, File, FileDiff, FileSearch, FolderOpen, Save } from "lucide-react";
import type { FileReference } from "./fileReference";
import { useFileMenu } from "./useFileMenu";
import { FileApplicationIcon } from "./FileApplicationIcon";
import styles from "./FileMenu.module.less";
import { downloadOrigin } from '../../../../web/src/downloads/downloadFeedback';
import { useThreadLongPress } from '../../../../../shared/chat/useThreadLongPress';

// Submenus may overlap the parent when two columns cannot fit in a narrow window.
const SUBMENU_PLACEMENTS: MenuProps["builtinPlacements"] = {
  rightTop: { points: ["tl", "tr"], overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } },
  leftTop: { points: ["tr", "tl"], overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } },
};

export function FileMenu({ path, line, column, children, className, onReview, preview = false }: FileReference & {
  children: ReactNode; className?: string; onReview?: () => void; preview?: boolean;
}) {
  const target = { path, ...(line && { line }), ...(column && { column }) };
  const menu = useFileMenu(target);
  const gesture = useThreadLongPress(() => menu.setOpen(true), { enabled: !menu.busy });
  const previewsFile = preview && menu.canPreview && !onReview;
  const openApplication = (application: string) => { void menu.perform({ type: "open", application }); };
  const vscode = menu.applications.find((application) => application.id === "vscode");
  const applications: MenuProps["items"] = menu.applications.map((app) => ({
    key: app.id, label: app.name,
    icon: <FileApplicationIcon application={app} />,
    onClick: () => openApplication(app.id),
  }));
  const saveItem = { key: "saveAs", label: uiText(menu.remote ? "client.composer.downloadToThisComputer" : "client.composer.saveAs"),
    icon: <Save size={16} />, disabled: !menu.desktop,
    onClick: ({ domEvent }: Parameters<NonNullable<MenuProps['onClick']>>[0]) => {
      void menu.perform({ type: "saveAs" }, downloadOrigin(domEvent));
    } };
  const items: MenuProps["items"] = menu.downloadOnly ? [saveItem] : [
    ...(previewsFile ? [{ key: "preview", label: uiText("client.composer.previewFile"), icon: <FileSearch size={16} />,
      onClick: () => { void menu.preview(); } }] : []),
    { key: "open", label: uiText(menu.remote ? "client.composer.openOnRemoteComputer" : "client.mobile.openFile"), icon: <File size={16} />,
      disabled: !menu.desktop,
      onClick: () => openApplication("default") },
    ...(vscode ? [{ key: "vscode", label: uiText("client.composer.openInVsCode"),
      icon: <FileApplicationIcon application={vscode} />, onClick: () => openApplication("vscode") }] : []),
    { key: "openWith", label: uiText("client.composer.openWith"), icon: <FolderOpen size={16} />, disabled: !menu.desktop,
      popupClassName: `${styles.popup} ${styles.submenu}`, children: [
        { key: "default", label: uiText("client.composer.defaultApp"), icon: <File size={16} />, onClick: () => openApplication("default") },
        ...applications,
        ...(menu.loading ? [{ key: "loading", label: uiText("client.composer.findingApps"), disabled: true }] : []),
        ...(menu.failed ? [{ key: "failed", label: uiText("client.composer.couldNotLoadAppsPleaseReopenTheMenu"), disabled: true }] : []),
      ] },
    { type: "divider" },
    ...(onReview ? [{ key: "review", label: uiText("client.composer.viewChanges"), icon: <FileDiff size={16} />, onClick: onReview }] : []),
    saveItem,
    { key: "copyFile", label: uiText(menu.remote ? "client.composer.copyFileOnRemoteComputer" : "client.composer.copyFile"), icon: <Copy size={16} />,
      disabled: !menu.desktop,
      onClick: () => { void menu.perform({ type: "copyFile" }); } },
    { key: "copyPath", label: uiText("client.composer.copyPath"), icon: <Copy size={16} />,
      onClick: () => { void menu.perform({ type: "copyPath" }); } },
    { key: "copyContents", label: uiText("client.chat.copyFileContents"), icon: <Copy size={16} />, disabled: !menu.desktop,
      onClick: () => { void menu.perform({ type: "copyContents" }); } },
    { key: "reveal", label: uiText(menu.remote ? "client.composer.showInRemoteFileManager" : "client.composer.showInFileManager"),
      icon: <FolderOpen size={16} />, disabled: !menu.desktop,
      onClick: () => { void menu.perform({ type: "reveal" }); } },
  ];
  // The browser retains its existing diff shortcut; local file operations belong to the desktop.
  if (!menu.desktop && onReview) return <button type="button" className={className}
    onClick={onReview} aria-label={uiText("client.composer.viewChangesTo", { value1: path })}>{children}</button>;
  return <Dropdown trigger={onReview || previewsFile ? ["contextMenu"] : ["click", "contextMenu"]}
    open={menu.open} onOpenChange={menu.setOpen} autoFocus
    overlayClassName={styles.popup} overlayStyle={{ maxWidth: 400 }}
    menu={{ items, triggerSubMenuAction: "hover", builtinPlacements: SUBMENU_PLACEMENTS,
      expandIcon: <ChevronRight size={14} aria-hidden="true" />,
      onClick: () => menu.setOpen(false) }} disabled={menu.busy}>
    <button {...gesture} type="button" className={className ?? styles.link}
      aria-label={onReview ? uiText("client.composer.viewChangesTo", { value1: path }) : uiText("client.desktopGuiErrors.message", { value1: uiText(previewsFile ? "client.composer.previewFile" : "client.projectBrowser.fileActions"), value2: path })}
      onClick={() => {
        if (onReview) { menu.setOpen(false); onReview(); }
        else if (previewsFile) void menu.preview();
      }}
      aria-haspopup="menu" aria-expanded={menu.open} disabled={menu.busy}>{children}</button>
  </Dropdown>;
}
