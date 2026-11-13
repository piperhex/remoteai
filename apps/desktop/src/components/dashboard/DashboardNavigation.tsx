import {
  BarChart3,
  Bot,
  Download,
  FolderOpen,
  PackageOpen,
  Palette,
  SquareTerminal,
  Settings,
  ShieldCheck,
  UserRound,
  MessagesSquare,
  Globe,
} from "lucide-react";
import type { Translate } from "../../i18n";
import { LogDiagnosticsIcon } from "./LogDiagnosticsIcon";
import { DownloadNavigationIcon } from "../../downloads/DownloadNavigationIcon";
import { LoungeIcon } from "../../../../../shared/lounge/LoungeIcon";
import { displayText } from "../../../../../shared/localization/messages";
import { marketText } from "../../../../../shared/provider-market/i18n";
import { guiLanguage } from "../../../../../shared/localization/uiText";

export type DashboardPage =
  | "accounts"
  | "providers"
  | "codexGui"
  | "tokens"
  | "dreamSkin"
  | "skills"
  | "coze"
  | "sessions"
  | "systemPrompts"
  | "settings"
  | "codexConfig"
  | "logDiagnostics"
  | "downloads"
  | "lounge"
  | "browser"
  | "totp"
  | "claudeCode";

export type AccountManagementPage = "accounts" | "providers" | "claudeCode";

export function isAccountManagementPage(page: DashboardPage): page is AccountManagementPage {
  return page === "accounts" || page === "providers" || page === "claudeCode";
}

interface DashboardNavigationProps {
  collapsed?: boolean;
  downloadOwner?: string;
  loungeUnread?: number;
  loungeAvailable?: boolean;
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
  page: "logDiagnostics", icon: LogDiagnosticsIcon, labelKey: "logDiagnostics.title",
} as const;
const DOWNLOADS_ITEM = { page: "downloads", icon: Download, labelKey: "downloads.title" } as const;
const LOUNGE_ITEM = { page: "lounge", icon: MessagesSquare,
  get label() { return displayText('client.lounge.title'); } } as const;
const BROWSER_ITEM = { page: "browser", icon: Globe,
  get label() { return marketText(guiLanguage())('market.browserNavigation'); } } as const;

const TOTP_ITEM = { page: "totp", icon: ShieldCheck, labelKey: "totp.action" } as const;

const TOOLBOX_NAVIGATION_ITEMS = [
  { page: "tokens", icon: BarChart3, labelKey: "nav.tokenUsage" },
  { page: "dreamSkin", icon: Palette, labelKey: "nav.dreamSkin" },
  { page: "skills", icon: PackageOpen, labelKey: "nav.skills" },
  { page: "coze", icon: Bot, label: "Coze" },
  BROWSER_ITEM,
] as const;

export function isToolboxPage(page: DashboardPage) {
  return page === "codexConfig" || page === "systemPrompts" || page === "logDiagnostics"
    || page === "downloads" || page === "lounge" || page === "totp" || page === "browser"
    || TOOLBOX_NAVIGATION_ITEMS.some((item) => item.page === page);
}

export function DashboardNavigation({
  collapsed = false,
  downloadOwner,
  loungeUnread,
  loungeAvailable = false,
  onPageChange,
  page,
  t,
  variant = "top",
}: DashboardNavigationProps) {
  const navigationButton = (item: typeof NAVIGATION_ITEMS[number] | typeof TOOLBOX_NAVIGATION_ITEMS[number]
    | typeof LOUNGE_ITEM | typeof BROWSER_ITEM | {
    page: "settings" | "logDiagnostics" | "downloads" | "totp";
    icon: typeof Settings;
    labelKey: "nav.settings" | "logDiagnostics.title" | "downloads.title" | "totp.action";
  }) => {
    const Icon = item.icon;
    const label = "label" in item ? item.label : t(item.labelKey);
    const selected = page === item.page || (isAccountManagementPage(page) && item.page === "accounts");
    return (
      <button key={item.page} type="button" className={selected ? "selected" : ""}
        aria-current={selected ? "page" : undefined}
        aria-label={collapsed || item.page === "downloads" || item.page === "lounge" ? label : undefined}
        title={collapsed ? label : undefined}
        onClick={() => onPageChange(selected ? page : item.page)}>
        {item.page === "downloads" && <DownloadNavigationIcon owner={downloadOwner} />}
        {item.page === "lounge" && <LoungeIcon unread={loungeUnread} />}
        {item.page !== "downloads" && item.page !== "lounge" && <Icon size={19} />}
        <span>{label}</span>
      </button>
    );
  };
  return (
    <nav className={`${variant}-tabs`}
      aria-label={t("nav.aria")}
      data-tauri-drag-region={variant === "sidebar" ? true : undefined}>
      {variant !== "toolbox" && NAVIGATION_ITEMS.map(navigationButton)}
      {variant !== "top" && TOOLBOX_NAVIGATION_ITEMS
        .filter((item) => variant === "toolbox" || (item.page !== "skills" && item.page !== "dreamSkin"))
        .map(navigationButton)}
      {variant === "toolbox" && loungeAvailable && navigationButton(LOUNGE_ITEM)}
      {variant === "toolbox" && navigationButton(DOWNLOADS_ITEM)}
      {variant === "toolbox" && navigationButton(LOG_DIAGNOSTICS_ITEM)}
      {variant === "toolbox" && navigationButton(TOTP_ITEM)}
      {variant === "sidebar" && (
        <div className="sidebar-nav-tools" data-tauri-drag-region>
          {loungeAvailable && navigationButton(LOUNGE_ITEM)}
          {navigationButton(DOWNLOADS_ITEM)}
          {navigationButton(LOG_DIAGNOSTICS_ITEM)}
          {navigationButton(TOTP_ITEM)}
          {navigationButton({ page: "settings", icon: Settings, labelKey: "nav.settings" })}
        </div>
      )}
    </nav>
  );
}
