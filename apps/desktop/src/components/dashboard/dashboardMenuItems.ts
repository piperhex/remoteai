import type { MenuProps } from "antd";
import type { Translate } from "../../i18n";
import type { MenuSearchItem } from "../MenuSearchModal";
import { displayText } from "../../../../../shared/localization/messages";

export interface DashboardMenuItems {
  cloud: MenuProps["items"];
  file: MenuProps["items"];
  help: MenuProps["items"];
  navigate: MenuProps["items"];
  search: MenuSearchItem[];
  tools: MenuProps["items"];
  view: MenuProps["items"];
}

function fileItems(t: Translate, desktopApp: boolean): MenuProps["items"] {
  return [
    { key: "add-account", label: t("actions.addAccount") },
    { type: "divider" },
    { key: "import-archive", label: t("actions.importArchive") },
    { key: "export-archive", label: t("actions.exportArchive") },
    { type: "divider" },
    { key: "open-codex-home", label: t("windowMenu.openCodexHome") },
    { key: "open-remote-ai-home", label: t("windowMenu.openRemoteAiHome") },
    { type: "divider" },
    { key: "restart-app", label: t("windowMenu.restartApp"), disabled: !desktopApp },
    { key: "quit-app", label: t("windowMenu.quit"), disabled: !desktopApp },
  ];
}

function navigateItems(t: Translate, authenticated: boolean): MenuProps["items"] {
  return [
    { key: "codex-gui", label: t("nav.codexGui") },
    { key: "account-management", label: t("nav.accounts"), children: [
      { key: "accounts", label: t("accounts.officialTab") },
      { key: "providers", label: t("nav.providers") },
      { key: "claude-code", label: t("nav.claudeCode") },
    ] },
    { key: "token-usage", label: t("nav.tokenUsage") },
    { type: "divider" },
    { key: "dream-skin", label: t("nav.dreamSkin") },
    { key: "skills", label: t("nav.skills") },
    { key: "coze", label: "Coze" },
    { key: "sessions", label: t("nav.sessions") },
    ...(authenticated ? [{ key: "lounge", label: displayText("client.lounge.title") }] : []),
    { key: "downloads", label: t("downloads.title") },
    { key: "log-diagnostics", label: t("logDiagnostics.title") },
    { key: "totp", label: t("totp.action") },
    { type: "divider" },
    { key: "settings", label: t("nav.settings") },
  ];
}

function viewItems(t: Translate): MenuProps["items"] {
  return [{
    key: "navigation-style",
    label: t("settings.navigationStyle.title"),
    children: [
      { key: "navigation-style-top", label: t("settings.navigationStyle.top") },
      { key: "navigation-style-sidebar", label: t("settings.navigationStyle.sidebar") },
    ],
  }];
}

function toolItems(t: Translate): MenuProps["items"] {
  return [
    { key: "system-prompts", label: t("nav.systemPrompts") },
    { key: "dream-skin", label: t("nav.dreamSkin") },
    { key: "skills", label: t("nav.skills") },
    { key: "codex-config", label: t("nav.codexConfig") },
    { type: "divider" },
    { key: "refresh-all", label: t("actions.refreshAll") },
    { key: "refresh-reset-credits", label: t("actions.refreshResetCredits") },
    { key: "open-token-window", label: t("windowMenu.openTokenWindow") },
    { key: "network-proxy", label: t("settings.networkProxy.title") },
    { type: "divider" },
    { key: "start-chatgpt", label: t("actions.startChatGpt") },
    { key: "restart-chatgpt", label: t("actions.restartChatGpt") },
    { type: "divider" },
    { key: "export-logs", label: t("settings.logs.export") },
  ];
}

function cloudItems(t: Translate, authenticated: boolean): MenuProps["items"] {
  return [
    { key: "cloud-account", label: authenticated ? t("cloud.accountDetails") : t("cloud.login") },
    { key: "cloud-sync", label: t("cloud.sync") },
    { key: "cloud-logout", label: t("cloud.logout"), disabled: !authenticated },
  ];
}

function helpItems(t: Translate): MenuProps["items"] {
  return [
    { key: "notifications", label: t("notification.title") },
    { key: "help", label: t("help.open") },
    { key: "check-update", label: t("update.check") },
    { key: "feedback", label: t("feedback.title") },
    { type: "divider" },
    { key: "repository", label: t("help.github") },
    { key: "about", label: t("about.open") },
  ];
}

function searchItems(t: Translate, authenticated: boolean, desktopApp: boolean): MenuSearchItem[] {
  const item = (id: string, label: string, group: string, disabled = false) => (
    { id, label, group, disabled }
  );
  return [
    item("add-account", t("actions.addAccount"), t("windowMenu.file")),
    item("import-archive", t("actions.importArchive"), t("windowMenu.file")),
    item("export-archive", t("actions.exportArchive"), t("windowMenu.file")),
    item("open-codex-home", t("windowMenu.openCodexHome"), t("windowMenu.file")),
    item("open-remote-ai-home", t("windowMenu.openRemoteAiHome"), t("windowMenu.file")),
    item("restart-app", t("windowMenu.restartApp"), t("windowMenu.file"), !desktopApp),
    item("quit-app", t("windowMenu.quit"), t("windowMenu.file"), !desktopApp),
    item("navigation-style-top", t("settings.navigationStyle.top"), t("windowMenu.view")),
    item("navigation-style-sidebar", t("settings.navigationStyle.sidebar"), t("windowMenu.view")),
    item("codex-gui", t("nav.codexGui"), t("windowMenu.navigate")),
    item("accounts", t("nav.accounts"), t("windowMenu.navigate")),
    item("providers", t("nav.providers"), t("windowMenu.navigate")),
    item("claude-code", t("nav.claudeCode"), t("windowMenu.navigate")),
    item("token-usage", t("nav.tokenUsage"), t("windowMenu.navigate")),
    item("coze", "Coze", t("windowMenu.navigate")),
    item("sessions", t("nav.sessions"), t("windowMenu.navigate")),
    ...(authenticated ? [item("lounge", displayText("client.lounge.title"), t("windowMenu.navigate"))] : []),
    item("downloads", t("downloads.title"), t("windowMenu.navigate")),
    item("log-diagnostics", t("logDiagnostics.title"), t("windowMenu.navigate")),
    item("totp", t("totp.action"), t("windowMenu.navigate")),
    item("proxy-sessions", t("nav.proxySessions"), t("windowMenu.navigate")),
    item("system-prompts", t("nav.systemPrompts"), t("windowMenu.tools")),
    item("dream-skin", t("nav.dreamSkin"), t("windowMenu.tools")),
    item("skills", t("nav.skills"), t("windowMenu.tools")),
    item("codex-config", t("nav.codexConfig"), t("windowMenu.tools")),
    item("settings", t("nav.settings"), t("windowMenu.navigate")),
    item("refresh-all", t("actions.refreshAll"), t("windowMenu.tools")),
    item("refresh-reset-credits", t("actions.refreshResetCredits"), t("windowMenu.tools")),
    item("open-token-window", t("windowMenu.openTokenWindow"), t("windowMenu.tools")),
    item("network-proxy", t("settings.networkProxy.title"), t("windowMenu.tools")),
    item("start-chatgpt", t("actions.startChatGpt"), t("windowMenu.tools")),
    item("restart-chatgpt", t("actions.restartChatGpt"), t("windowMenu.tools")),
    item("export-logs", t("settings.logs.export"), t("windowMenu.tools")),
    item("cloud-account", authenticated ? t("cloud.accountDetails") : t("cloud.login"), t("windowMenu.cloud")),
    item("cloud-sync", t("cloud.sync"), t("windowMenu.cloud")),
    item("cloud-logout", t("cloud.logout"), t("windowMenu.cloud"), !authenticated),
    item("notifications", t("notification.title"), t("windowMenu.help")),
    item("help", t("help.open"), t("windowMenu.help")),
    item("check-update", t("update.check"), t("windowMenu.help")),
    item("feedback", t("feedback.title"), t("windowMenu.help")),
    item("repository", t("help.github"), t("windowMenu.help")),
    item("about", t("about.open"), t("windowMenu.help")),
  ];
}

export function buildDashboardMenuItems(t: Translate, authenticated: boolean, desktopApp: boolean): DashboardMenuItems {
  return {
    cloud: cloudItems(t, authenticated),
    file: fileItems(t, desktopApp),
    help: helpItems(t),
    navigate: navigateItems(t, authenticated),
    search: searchItems(t, authenticated, desktopApp),
    tools: toolItems(t),
    view: viewItems(t),
  };
}
