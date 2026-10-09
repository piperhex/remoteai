import type { AccountDisplayMode } from "../../hooks/useAccountDisplayMode";
import type { NavigationStyle } from "../../hooks/useNavigationStyle";
import type { Language, Translate } from "../../i18n";
import type {
  AppInfo,
  BubbleResetDisplay,
  BubbleStyle,
  CodexHomeEntry,
  CodexHomePreset,
  NetworkProxySettings,
  Provider,
} from "../../types";

export interface SettingsPageProps {
  providers: Provider[];
  sseIdleTimeout: ReturnType<typeof import("../../hooks/useSseIdleTimeout").useSseIdleTimeout>;
  info: AppInfo | null;
  autoUpdateEnabled: boolean;
  onAutoUpdateChange: (enabled: boolean) => void;
  launchAtStartupEnabled: boolean;
  launchAtStartupLoading: boolean;
  onLaunchAtStartupChange: (enabled: boolean) => void;
  closeToTrayEnabled: boolean;
  closeToTrayLoading: boolean;
  onCloseToTrayChange: (enabled: boolean) => void;
  autoRefreshEnabled: boolean;
  autoRefreshSeconds: number;
  onEnabledChange: (enabled: boolean) => void;
  onSecondsChange: (value: number | string | null) => void;
  currentAutoRefreshTarget: string | null;
  accountAutoRefreshEnabled: boolean;
  accountAutoRefreshSeconds: number;
  onAccountAutoRefreshEnabledChange: (enabled: boolean) => void;
  onAccountAutoRefreshSecondsChange: (value: number | string | null) => void;
  themeColor: string;
  themeColorLoading: boolean;
  onThemeColorChange: (color: string) => void;
  navigationStyle: NavigationStyle;
  onNavigationStyleChange: (style: NavigationStyle) => void;
  cloudBaseUrl: string;
  cloudBaseUrlLoading: boolean;
  cloudAuthenticated: boolean;
  showCustomCloudServer: boolean;
  onCloudBaseUrlSave: (baseUrl: string) => Promise<void> | void;
  totpCloudSyncEnabled: boolean;
  totpCloudSyncLoading: boolean;
  onTotpCloudSyncChange: (enabled: boolean) => void;
  floatingBubbleEnabled: boolean;
  floatingBubbleLoading: boolean;
  onFloatingBubbleChange: (enabled: boolean) => void;
  bubbleResetDisplay: BubbleResetDisplay;
  bubbleResetDisplayLoading: boolean;
  onBubbleResetDisplayChange: (display: BubbleResetDisplay) => void;
  bubbleStyle: BubbleStyle;
  bubbleStyleLoading: boolean;
  onBubbleStyleChange: (style: BubbleStyle) => void;
  privacyModeEnabled: boolean;
  hideAccountNotes: boolean;
  privacyModeLoading: boolean;
  onPrivacyModeChange: (enabled: boolean) => void;
  onHideAccountNotesChange: (enabled: boolean) => void;
  accountDisplayMode: AccountDisplayMode;
  onAccountDisplayModeChange: (mode: AccountDisplayMode) => void;
  tokenUsageWeeks: number;
  tokenUsageRefreshSeconds: number;
  codexUsageSummaryEnabled: boolean;
  tokenUsagePreferencesLoading: boolean;
  autoDisableStatusCodes: number[];
  autoDisableStatusCodesLoading: boolean;
  onAutoDisableStatusCodesChange: (statusCodes: number[]) => Promise<void> | void;
  upstream429RetryTimeoutSeconds: number;
  upstream429RetryTimeoutLoading: boolean;
  onUpstream429RetryTimeoutChange: (value: number | string | null) => void;
  showUsageNetworkErrors: boolean;
  showUsageNetworkErrorsLoading: boolean;
  onShowUsageNetworkErrorsChange: (enabled: boolean) => Promise<void> | void;
  webProxyPort?: number | null;
  webProxyListenOnAllInterfaces?: boolean;
  webProxyPortLoading?: boolean;
  onWebProxyPortChange?: (port: number | null) => void;
  onWebProxyListenOnAllInterfacesChange?: (enabled: boolean) => void;
  onCopyWebProxyLanApiKey?: () => Promise<void> | void;
  onOpenWebVersion?: (url: string) => void;
  networkProxy: NetworkProxySettings;
  networkProxyLoading: boolean;
  onNetworkProxySave: (settings: NetworkProxySettings) => Promise<boolean>;
  onTokenUsageWeeksChange: (value: number | string | null) => void;
  onTokenUsageRefreshSecondsChange: (value: number | string | null) => void;
  onCodexUsageSummaryEnabledChange: (enabled: boolean) => void;
  codexHomes: CodexHomeEntry[];
  codexHomePresets: CodexHomePreset[];
  codexHomeLoading: boolean;
  onAddCodexHome: () => void;
  onAddCodexHomePath: (path: string) => void;
  onChooseNewCodexHome: () => void;
  onCodexHomePathChange: (id: string, path: string) => void;
  onCommitCodexHomePath: (id: string) => void;
  onChooseCodexHome: (id: string) => void;
  onCodexHomeEnabledChange: (id: string, enabled: boolean) => void;
  onRemoveCodexHome: (id: string) => void;
  onOpenCodexHome: () => void;
  onOpenAccountStore: () => void;
  onExportLogs: () => void;
  exportingLogs: boolean;
  language: Language;
  onLanguageChange: (language: Language) => void;
  t: Translate;
}
