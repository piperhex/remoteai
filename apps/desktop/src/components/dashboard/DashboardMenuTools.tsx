import type { CSSProperties } from "react";
import { Popover, Tooltip } from "antd";
import {
  Bell,
  CircleHelp,
  Cloud,
  Download,
  Github,
  Globe2,
  LogIn,
  LogOut,
  MessageSquareText,
  Moon,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  UploadCloud,
} from "lucide-react";
import type { useAppUpdate } from "../../hooks/useAppUpdate";
import type { useCloudAuth } from "../../hooks/useCloudAuth";
import type { useCloudContent } from "../../hooks/useCloudContent";
import type { Language, Translate } from "../../i18n";
import type { ThemeMode } from "../../utils/themeMode";
import { NotificationPanel } from "./NotificationPanel";
import type { LoungeAccount } from '../../../../../shared/lounge/types';
import { CloudAccountMenu } from './CloudAccountMenu';

interface MenuActions {
  checkForUpdates: () => void;
  downloadAndroidApk: () => void;
  openAbout: () => void;
  openCloudAccount: () => void;
  openCloudLogin: () => void;
  openCloudWebVersion: () => void;
  openFeedback: () => void;
  openHelp: () => void;
  openNotificationLink: (link: string) => void;
  openRepository: () => void;
  openSettings: () => void;
  syncCloud: () => void;
}

interface DashboardMenuToolsProps {
  actions: MenuActions;
  appUpdate: ReturnType<typeof useAppUpdate>;
  cloud: ReturnType<typeof useCloudAuth>;
  loungeUser?: LoungeAccount;
  cloudContent: ReturnType<typeof useCloudContent>;
  language: Language;
  onToggleThemeMode: () => void;
  t: Translate;
  themeMode: ThemeMode;
}

function ThemeModeButton({ mode, onToggle, t }: {
  mode: ThemeMode;
  onToggle: () => void;
  t: Translate;
}) {
  const label = t(mode === "dark" ? "themeMode.switchToLight" : "themeMode.switchToDark");
  return (
    <Tooltip title={label}>
      <button type="button" className="theme-mode-button" aria-label={label} onClick={onToggle}>
        {mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </Tooltip>
  );
}

function menuItems(options: DashboardMenuToolsProps) {
  const { actions, appUpdate, cloud, t } = options;
  const sharedItems = [
    { key: "settings", icon: <Settings size={15} />, label: t("nav.settings") },
    { key: "checkUpdate", icon: <RefreshCw size={15} />, label: t("update.check"),
      disabled: appUpdate.checkingForUpdate },
    { key: "downloadAndroidApk", icon: <Download size={15} />, label: t("help.downloadAndroidApk") },
    { key: "openCloudWeb", icon: <Globe2 size={15} />, label: t("help.openCloudWeb") },
    { key: "feedback", icon: <MessageSquareText size={15} />, label: t("feedback.title") },
    { key: "repository", icon: <Github size={15} />, label: t("help.github") },
    { key: "help", icon: <CircleHelp size={15} />, label: t("help.open") },
    { key: "about", icon: <ShieldCheck size={15} />, label: t("about.open") },
  ];
  const accountItems = cloud.state.authenticated ? [
    { key: "account", icon: <Cloud size={15} />, label: t("cloud.accountDetails") },
    { key: "sync", icon: <UploadCloud className={cloud.syncing ? "spin" : ""} size={15} />,
      label: t("cloud.sync"), disabled: cloud.syncing },
    { type: "divider" as const },
    { key: "logout", icon: <LogOut size={15} />, label: t("cloud.logout"), disabled: cloud.loading },
  ] : [
    { key: "login", icon: <LogIn size={15} />, label: t("cloud.login"), disabled: cloud.loading },
  ];
  return [...accountItems, { type: "divider" as const }, ...sharedItems].map((item) => item);
}

function handleMenuClick(key: string, options: DashboardMenuToolsProps) {
  const { actions, cloud } = options;
  if (key === "account") actions.openCloudAccount();
  if (key === "sync") actions.syncCloud();
  if (key === "logout") void cloud.logout();
  if (key === "login") actions.openCloudLogin();
  if (key === "settings") actions.openSettings();
  if (key === "checkUpdate") actions.checkForUpdates();
  if (key === "downloadAndroidApk") actions.downloadAndroidApk();
  if (key === "openCloudWeb") actions.openCloudWebVersion();
  if (key === "feedback") actions.openFeedback();
  if (key === "help") actions.openHelp();
  if (key === "about") actions.openAbout();
  if (key === "repository") actions.openRepository();
}

export function DashboardMenuTools(options: DashboardMenuToolsProps) {
  const {
    actions,
    appUpdate,
    cloud,
    cloudContent,
    language,
    onToggleThemeMode,
    t,
    themeMode,
  } = options;
  const unreadCount = cloudContent.notifications.filter((notification) => {
    if (!cloudContent.lastNotificationSeenAt) return true;
    return new Date(notification.updatedAt).getTime()
      > new Date(cloudContent.lastNotificationSeenAt).getTime();
  }).length;
  return (
    <div className="menu-tools">
      <CloudAccountMenu email={cloud.state.userEmail} user={options.loungeUser}
        authenticated={cloud.state.authenticated} loading={cloud.loading} t={t} menu={{
        items: menuItems(options),
        onClick: ({ key }) => handleMenuClick(key, options),
      }} />
      {cloud.state.authenticated && (
        <Tooltip title={t("cloud.syncDescription")}>
          <button type="button" className="cloud-sync-menu-button" aria-label={t("cloud.sync")}
            disabled={cloud.syncing} onClick={actions.syncCloud}>
            <UploadCloud className={cloud.syncing ? "spin" : ""} size={18} />
          </button>
        </Tooltip>
      )}
      <Popover placement="bottomRight" trigger="click" open={cloudContent.notificationsOpen}
        content={<NotificationPanel language={language} notifications={cloudContent.notifications}
          onOpenLink={actions.openNotificationLink} t={t} />}
        onOpenChange={(open) => {
          cloudContent.setNotificationsOpen(open);
          if (open) cloudContent.markNotificationsSeen();
        }}>
        <button type="button" className="notification-button" aria-label={t("notification.title")}>
          <Bell size={18} />
          {unreadCount > 0 && <span className="notification-unread-badge" aria-hidden="true" />}
        </button>
      </Popover>
      <ThemeModeButton mode={themeMode} onToggle={onToggleThemeMode} t={t} />
      {appUpdate.availableUpdate
        && (appUpdate.updateDownloaded || (appUpdate.downloadingUpdate && appUpdate.downloadRequested)) && (
        <Tooltip title={appUpdate.downloadingUpdate
          ? (appUpdate.updateProgress === null ? t("update.backgroundDownloading")
            : t("update.downloading", { progress: appUpdate.updateProgress }))
          : t("update.ready")}>
          <button type="button"
            className={`update-ready-button${appUpdate.downloadingUpdate ? " downloading" : ""}`}
            style={appUpdate.downloadingUpdate
              ? { "--update-progress": `${appUpdate.updateProgress ?? 0}%` } as CSSProperties
              : undefined}
            aria-label={appUpdate.downloadingUpdate ? t("update.backgroundDownloading") : t("update.ready")}
            onClick={() => appUpdate.setShowUpdatePrompt(true)}>
            {appUpdate.downloadingUpdate
              ? <RefreshCw className="spin" size={18} /> : <Download size={18} />}
            {appUpdate.updateDownloaded && !appUpdate.downloadingUpdate
              && <span className="update-install-badge" aria-hidden="true" />}
          </button>
        </Tooltip>
      )}
    </div>
  );
}
