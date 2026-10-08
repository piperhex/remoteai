import {
  BarChart3,
  ClipboardList,
  Download,
  FolderOpen,
  FileSliders,
  PackageOpen,
  Palette,
  SquareTerminal,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { Translate } from "../../i18n";

export type DashboardPage =
  | "accounts"
  | "providers"
  | "codexGui"
  | "tokens"
  | "dreamSkin"
  | "skills"
  | "sessions"
  | "systemPrompts"
  | "settings"
  | "codexConfig"
  | "logDiagnostics"
  | "downloads"
  | "totp"
  | "claudeCode";

export type AccountManagementPage = "accounts" | "providers" | "claudeCode";

export function isAccountManagementPage(page: DashboardPage): page is AccountManagementPage {
  return page === "accounts" || page === "providers" || page === "claudeCode";
}

interface DashboardNavigationProps {
  collapsed?: boolean;
  onPageChange: (page: DashboardPage) => void;
  page: DashboardPage;
  t: Translate;
  variant?: "top" | "sidebar" | "toolbox";
}

const NAVIGATION_ITEMS = [
  { page: "codexGui", icon: SquareTerminal, labelKey: "nav.codexGui" },
  { page: "accounts", icon: UserRound, labelKey: "nav.accounts" },
  { page: "sessions", icon: FolderOpen, labelKey: "nav.sessions" },
] as const;

const LOG_DIAGNOSTICS_ITEM = {
  page: "logDiagnostics", icon: ClipboardList, labelKey: "logDiagnostics.title",
} as const;
const DOWNLOADS_ITEM = { page: "downloads", icon: Download, labelKey: "downloads.title" } as const;

const TOTP_ITEM = { page: "totp", icon: ShieldCheck, labelKey: "totp.action" } as const;

const TOOLBOX_NAVIGATION_ITEMS = [
  { page: "tokens", icon: BarChart3, labelKey: "nav.tokenUsage" },
  { page: "dreamSkin", icon: Palette, labelKey: "nav.dreamSkin" },
  { page: "skills", icon: PackageOpen, labelKey: "nav.skills" },
] as const;

export function isToolboxPage(page: DashboardPage) {
  return page === "systemPrompts" || page === "logDiagnostics" || page === "downloads" || page === "totp"
    || TOOLBOX_NAVIGATION_ITEMS.some((item) => item.page === page);
}

export function DashboardNavigation({
  collapsed = false,
  onPageChange,
  page,
  t,
  variant = "top",
}: DashboardNavigationProps) {
  const navigationButton = (item: typeof NAVIGATION_ITEMS[number] | typeof TOOLBOX_NAVIGATION_ITEMS[number] | {
    page: "settings" | "codexConfig" | "logDiagnostics" | "downloads" | "totp";
    icon: typeof Settings;
    labelKey: "nav.settings" | "nav.codexConfig" | "logDiagnostics.title" | "downloads.title" | "totp.action";
  }) => {
    const Icon = item.icon;
    const label = t(item.labelKey);
    const selected = page === item.page || (isAccountManagementPage(page) && item.page === "accounts");
    return (
      <button key={item.page} type="button" className={selected ? "selected" : ""}
        aria-current={selected ? "page" : undefined}
        aria-label={collapsed ? label : undefined} title={collapsed ? label : undefined}
        onClick={() => onPageChange(selected ? page : item.page)}>
        <Icon size={19} /><span>{label}</span>
      </button>
    );
  };
  return (
    <nav className={`${variant}-tabs`}
      aria-label={t("nav.aria")}
      data-tauri-drag-region={variant === "sidebar" ? true : undefined}>
      {variant !== "toolbox" && NAVIGATION_ITEMS.map(navigationButton)}
      {variant !== "top" && TOOLBOX_NAVIGATION_ITEMS.map(navigationButton)}
      {variant === "toolbox" && navigationButton(DOWNLOADS_ITEM)}
      {variant === "toolbox" && navigationButton(LOG_DIAGNOSTICS_ITEM)}
      {variant === "toolbox" && navigationButton(TOTP_ITEM)}
      {variant === "sidebar" && (
        <div className="sidebar-nav-tools" data-tauri-drag-region>
          {navigationButton(DOWNLOADS_ITEM)}
          {navigationButton(LOG_DIAGNOSTICS_ITEM)}
          {navigationButton(TOTP_ITEM)}
          {navigationButton({ page: "codexConfig", icon: FileSliders, labelKey: "nav.codexConfig" })}
          {navigationButton({ page: "settings", icon: Settings, labelKey: "nav.settings" })}
        </div>
      )}
    </nav>
  );
}
