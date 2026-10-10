import { guiText } from "../../i18n/guiText";
import type { ReactNode } from "react";
import { Dropdown, type MenuProps } from "antd";
import { ChevronRight, Copy, File, FileDiff, FolderOpen, Save } from "lucide-react";
import type { FileReference } from "./fileReference";
import { useFileMenu } from "./useFileMenu";
import { FileApplicationIcon } from "./FileApplicationIcon";
import styles from "./FileMenu.module.less";

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
  const previewsFile = preview && menu.canPreview && !onReview;
  const openApplication = (application: string) => { void menu.perform({ type: "open", application }); };
  const vscode = menu.applications.find((application) => application.id === "vscode");
  const applications: MenuProps["items"] = menu.applications.map((app) => ({
    key: app.id, label: app.name,
    icon: <FileApplicationIcon application={app} />,
    onClick: () => openApplication(app.id),
  }));
  const items: MenuProps["items"] = [
    { key: "open", label: guiText("打开文件"), icon: <File size={16} />, disabled: !menu.desktop,
      onClick: () => openApplication("default") },
    ...(vscode ? [{ key: "vscode", label: guiText("在 VS Code 中打开"),
      icon: <FileApplicationIcon application={vscode} />, onClick: () => openApplication("vscode") }] : []),
    { key: "openWith", label: guiText("打开方式"), icon: <FolderOpen size={16} />, disabled: !menu.desktop,
      popupClassName: styles.popup, children: [
        { key: "default", label: guiText("默认应用"), icon: <File size={16} />, onClick: () => openApplication("default") },
        ...applications,
        ...(menu.loading ? [{ key: "loading", label: guiText("正在查找应用…"), disabled: true }] : []),
        ...(menu.failed ? [{ key: "failed", label: guiText("未能读取应用，请重新打开菜单"), disabled: true }] : []),
      ] },
    { type: "divider" },
    ...(onReview ? [{ key: "review", label: guiText("查看差异"), icon: <FileDiff size={16} />, onClick: onReview }] : []),
    { key: "saveAs", label: guiText("另存为…"), icon: <Save size={16} />, disabled: !menu.desktop,
      onClick: () => { void menu.perform({ type: "saveAs" }); } },
    { key: "copyFile", label: guiText("复制文件"), icon: <Copy size={16} />, disabled: !menu.desktop,
      onClick: () => { void menu.perform({ type: "copyFile" }); } },
    { key: "copyPath", label: guiText("复制路径"), icon: <Copy size={16} />,
      onClick: () => { void menu.perform({ type: "copyPath" }); } },
    { key: "copyContents", label: guiText("复制文件内容"), icon: <Copy size={16} />, disabled: !menu.desktop,
      onClick: () => { void menu.perform({ type: "copyContents" }); } },
    { key: "reveal", label: guiText("在文件管理器中显示"), icon: <FolderOpen size={16} />, disabled: !menu.desktop,
      onClick: () => { void menu.perform({ type: "reveal" }); } },
  ];
  // The browser retains its existing diff shortcut; local file operations belong to the desktop.
  if (!menu.desktop && onReview) return <button type="button" className={className}
    onClick={onReview} aria-label={guiText("查看 {value1} 的差异", { value1: path })}>{children}</button>;
  return <Dropdown trigger={onReview || previewsFile ? ["contextMenu"] : ["click", "contextMenu"]}
    open={menu.open} onOpenChange={menu.setOpen} autoFocus
    overlayClassName={styles.popup} overlayStyle={{ maxWidth: 400 }}
    menu={{ items, builtinPlacements: SUBMENU_PLACEMENTS, expandIcon: <ChevronRight size={14} aria-hidden="true" />,
      onClick: () => menu.setOpen(false) }} disabled={menu.busy}>
    <button type="button" className={className ?? styles.link}
      aria-label={onReview ? guiText("查看 {value1} 的差异", { value1: path }) : guiText("{value1}：{value2}", { value1: previewsFile ? "预览文件" : "文件操作", value2: path })}
      onClick={() => {
        if (onReview) { menu.setOpen(false); onReview(); }
        else if (previewsFile) void menu.preview();
      }}
      aria-haspopup="menu" aria-expanded={menu.open} disabled={menu.busy}>{children}</button>
  </Dropdown>;
}
