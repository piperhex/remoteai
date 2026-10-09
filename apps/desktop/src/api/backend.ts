import { copyText } from "../utils/clipboard";
import type { ProxyServiceTier } from "../types";
import { cacheDisplayCurrencyRates } from "../utils/currencyDisplay";
import { invoke as invokeTauri } from "@tauri-apps/api/core";
import { hasDirectChatInput } from "../../../../shared/remote-chat/uploadMode";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { exit as exitApp, relaunch } from "@tauri-apps/plugin-process";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { checkAvailableAppUpdate } from "./appUpdateCheck";
import { chooseBrowserAccountFile } from "./browserAccountImport";
import { isAutoUpdateEnabled } from "./appUpdatePreferences";
import type { CodexConnectionStatus, CodexConnectResult } from "./codexConnectionTypes";
import { DEMO_ACCOUNTS, DEMO_INFO } from "../demo";
import { BUILT_IN_DREAM_SKIN_THEMES } from "../dreamSkinBuiltIns";
import { LANGUAGE_STORAGE_KEY, isLanguage, type Language } from "../i18n";
import {
  ANTIGRAVITY_FALLBACK_MODELS,
  isAntigravityProvider,
} from "../utils/antigravityProvider";
import { CLAUDE_CODE_FALLBACK_MODELS } from "../utils/claudeCodeProvider";
import { GROK_FALLBACK_MODELS } from "../utils/grokProvider";
import { findProviderPreset } from "../utils/providerCatalog";
import { loadStoredModelTokenCosts, persistStoredModelTokenCosts } from "../pages/providers/providerUtils";
import { estimateTokenCost } from "../utils/tokenCost";
import type { AccountQuotaHistory, DailyTokenUsageBreakdown } from "../types/tokenUsageAnalytics";
import { previewAccountQuotaHistory, previewTokenBreakdown } from "./tokenUsagePreview";
import { previewHasLocalProxyLanApiKey, previewSetLegacyLanApiKey } from "./localProxyLanKeysPreview";
import { normalizeTotpVault, TOTP_STORAGE_KEY, type TotpVault } from "../utils/totp";
import {
  normalizeThirdPartyAppWriteSettings,
  THIRD_PARTY_APP_IDS,
} from "../utils/thirdPartyApps";
import type {
  AutoResetSettings,
  Account,
  AccountDetailsDraft,
  AccountArchiveImportResult,
  AccountTokenUsageTotals,
  AggregateApi,
  AggregateApiInput,
  AppInfo,
  AppSettings,
  BubbleResetDisplay,
  BubbleStyle,
  CcSwitchImportRequest,
  CloudAuthenticationResult,
  CloudAuthState,
  CloudAnnouncement,
  CloudCurrencyRate,
  CloudCurrencyRates,
  CloudFaq,
  CloudNotification,
  CloudSyncResult,
  ClaudeCodeWriteTarget,
  CodexHomeEntry,
  CodexHomePreset,
  ThirdPartyAppWriteSettings,
  DeletedCloudProvider,
  CodexThreadBinEntry,
  CodexThreadBundlePreview,
  CodexThreadBundleResult,
  CodexThreadEntry,
  CodexThreadMigrationReport,
  CodexThreadMutationReport,
  CodexThreadTokenTotals,
  CodexThreadVisibilityReport,
  DreamSkinImportOptions,
  DreamSkinAppearance,
  DreamSkinCommunityPage,
  DreamSkinMarketResult,
  DreamSkinResourcesStatus,
  DreamSkinStatus,
  DailyTokenUsage,
  DeletedCloudAccount,
  DirectConversationSyncResult,
  FeedbackImageInput,
  LoginStart,
  LoginStatus,
  LocalProxyStartProgress,
  LocalProxyStatus,
  SystemPromptRule,
  LocalProxyStopProgress,
  ImageModelTarget,
  ImageRouteKind,
  NetworkProxySettings,
  ProxySession,
  ProxySessionRequest,
  ProxySessionLatencySummary,
  Provider,
  ProviderBalance,
  ProviderBalancePlatform,
  ProviderInput,
  ProviderTokenUsageTotals,
  ReasoningEffort,
  OfficialPluginItem,
  PromptPluginItem,
  PromptPluginPublishInput,
  ResetCreditsSummary,
  SavedCloudLogin,
  SkillMarketItem,
  SkillPackageSelection,
  SkillPublishInput,
  TokenUsageEntry,
  UpdateInfo,
  UsageSummary,
} from "../types";
import { DEFAULT_THEME_COLOR, normalizeThemeColor } from "../utils/theme";

export const isDesktopApp = "__TAURI_INTERNALS__" in window;
export const isHostedWebApp = document
  .querySelector('meta[name="codex-switch-runtime"]')
  ?.getAttribute("content") === "hosted";
export const hasLocalBackend = isDesktopApp || isHostedWebApp;
export const canManageCodexConnection = hasLocalBackend;

export async function syncCodexNotification(message: string): Promise<boolean> {
  if (!isDesktopApp) return false;
  return invoke<boolean>("sync_codex_notification", { message });
}

interface HostedInvokeResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

const HOSTED_WEB_API_KEY_STORAGE_KEY = "codex-switch:hosted-web-api-key";

function readHostedWebApiKey() {
  try {
    return window.sessionStorage.getItem(HOSTED_WEB_API_KEY_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeHostedWebApiKey(value: string) {
  try {
    if (value) window.sessionStorage.setItem(HOSTED_WEB_API_KEY_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(HOSTED_WEB_API_KEY_STORAGE_KEY);
  } catch {
    // Private browsing may disable session storage; the key remains in memory
    // for the current request flow instead.
  }
}

export interface HostedWebApiKeyRequest {
  resolve: (value: string | null) => void;
}

const hostedWebApiKeyRequestListeners = new Set<(request: HostedWebApiKeyRequest) => void>();
let pendingHostedWebApiKeyRequest: HostedWebApiKeyRequest | null = null;

export function subscribeToHostedWebApiKeyRequests(
  listener: (request: HostedWebApiKeyRequest) => void,
) {
  hostedWebApiKeyRequestListeners.add(listener);
  if (pendingHostedWebApiKeyRequest) listener(pendingHostedWebApiKeyRequest);
  return () => hostedWebApiKeyRequestListeners.delete(listener);
}

let hostedWebApiKeyPrompt: Promise<string | null> | null = null;
let hostedWebApiKeyRejected = false;

function requestHostedWebApiKey() {
  if (!hostedWebApiKeyPrompt) {
    let resolvePrompt: (value: string | null) => void = () => undefined;
    const request: HostedWebApiKeyRequest = {
      resolve: (value) => {
        if (pendingHostedWebApiKeyRequest === request) pendingHostedWebApiKeyRequest = null;
        resolvePrompt(value);
      },
    };
    hostedWebApiKeyPrompt = new Promise<string | null>((resolve) => {
      resolvePrompt = resolve;
      pendingHostedWebApiKeyRequest = request;
      hostedWebApiKeyRequestListeners.forEach((listener) => listener(request));
    }).finally(() => {
      hostedWebApiKeyPrompt = null;
    });
  }
  return hostedWebApiKeyPrompt;
}

export async function invoke<T = void>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isDesktopApp) return invokeTauri<T>(command, args);
  if (!isHostedWebApp) throw new Error(`Native command is unavailable in browser preview: ${command}`);

  const body = JSON.stringify({ command, args });
  const request = (apiKey: string) => fetch("/__codex_switch__/api/invoke", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(command === 'codex_gui_request' && hasDirectChatInput(args.request)
        ? { "X-Codex-Chat-Transfer": "direct" } : {}),
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    },
    cache: "no-store",
    body,
  });
  let response = await request(readHostedWebApiKey());
  if (response.status === 401) {
    if (hostedWebApiKeyRejected) {
      throw new Error("The LAN access key was rejected. Check the key in Remote AI and reload the page.");
    }
    writeHostedWebApiKey("");
    const suppliedKey = (await requestHostedWebApiKey())?.trim() || "";
    if (suppliedKey) {
      writeHostedWebApiKey(suppliedKey);
      response = await request(suppliedKey);
      if (response.status === 401) {
        writeHostedWebApiKey("");
        hostedWebApiKeyRejected = true;
      } else {
        hostedWebApiKeyRejected = false;
      }
    } else {
      hostedWebApiKeyRejected = true;
    }
  }
  if (!response.ok) {
    throw new Error((await response.text().catch(() => "")) || `Web command failed with HTTP ${response.status}`);
  }
  const payload = await response.json() as HostedInvokeResponse<T>;
  if (!payload.ok) throw new Error(payload.error || `Web command failed: ${command}`);
  return payload.result as T;
}

export function decodeTotpQrImage(dataBase64: string) {
  return invoke<string>("decode_totp_qr_image", { input: { dataBase64 } });
}

export async function restartApplication(): Promise<void> {
  if (isDesktopApp) await relaunch();
}

export async function quitApplication(): Promise<void> {
  if (isDesktopApp) await exitApp(0);
}
export const DEFAULT_CLOUD_BASE_URL = "https://codex.onepiper.cloud";
export const BASE_CURRENCY_RATE: CloudCurrencyRate = { code: "USD", name: "USD", rate: 1 };
export const DEFAULT_AUTO_DISABLE_STATUS_CODES = [401, 402, 403, 429] as const;
export const DEFAULT_UPSTREAM_429_RETRY_TIMEOUT_SECONDS = 60;
export const MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS = 1;
export const MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS = 3_600;
export const DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW = 272_000;
export const MAX_GPT_5_6_SOL_CONTEXT_WINDOW = 1_050_000;
export const MIN_GPT_5_6_SOL_CONTEXT_WINDOW = 1_000;
const RELEASES_URL = "https://github.com/piperhex/remoteai/releases/latest";
const PENDING_APP_UPDATE_VERSION_KEY = "codex-switch:pending-app-update-version";
let pendingAppUpdate: Update | null = null;
let appUpdateDownloaded = false;
let updateDownloadPromise: Promise<void> | null = null;
let updateInstallInProgress = false;
let pendingUpdateInstallPromise: Promise<void> | null = null;
const LAUNCH_AT_STARTUP_PREVIEW_KEY = "codex-switch:launch-at-startup";
const CLOSE_TO_TRAY_PREVIEW_KEY = "codex-switch:close-to-tray";
const NON_PROXY_ENHANCEMENTS_PREVIEW_KEY = "codex-switch:non-proxy-enhancements";
const FLOATING_BUBBLE_PREVIEW_KEY = "codex-switch:floating-bubble";
const PRIVACY_MODE_PREVIEW_KEY = "codex-switch:privacy-mode";
const HIDE_ACCOUNT_NOTES_PREVIEW_KEY = "codex-switch:hide-account-notes";
const BUBBLE_RESET_DISPLAY_PREVIEW_KEY = "codex-switch:bubble-reset-display";
const BUBBLE_STYLE_PREVIEW_KEY = "codex-switch:bubble-style";
const THEME_COLOR_PREVIEW_KEY = "codex-switch:theme-color";
const PROVIDER_GROUPS_PREVIEW_KEY = "codex-switch:provider-groups";
const ACCOUNT_GROUPS_PREVIEW_KEY = "codex-switch:account-groups";
const CLAUDE_CODE_WRITE_TARGET_PREVIEW_KEY = "codex-switch:claude-code-write-target";
const THIRD_PARTY_APP_WRITE_PREVIEW_KEY = "codex-switch:third-party-app-write";
const CLOUD_BASE_URL_PREVIEW_KEY = "codex-switch:cloud-base-url";
const NETWORK_PROXY_ENABLED_PREVIEW_KEY = "codex-switch:network-proxy-enabled";
const NETWORK_PROXY_URL_PREVIEW_KEY = "codex-switch:network-proxy-url";
const NETWORK_PROXY_PORT_PREVIEW_KEY = "codex-switch:network-proxy-port";
const CLOUD_USER_PREVIEW_KEY = "codex-switch:cloud-user-email";
const PROVIDERS_PREVIEW_KEY = "codex-switch:providers";
const AGGREGATE_APIS_PREVIEW_KEY = "codex-switch:aggregate-apis";
const DEFAULT_OPENAI_PROVIDER_MODEL = "gpt-6-astra";
const LOCAL_PROXY_PREVIEW_KEY = "codex-switch:local-proxy-running";
const LOCAL_PROXY_FAST_MODE_PREVIEW_KEY = "codex-switch:local-proxy-fast-mode";
const LOCAL_PROXY_SERVICE_TIER_PREVIEW_KEY = "codex-switch:local-proxy-service-tier";
const LOCAL_PROXY_AUTO_SWITCH_PREVIEW_KEY = "codex-switch:local-proxy-auto-switch";
const LOCAL_PROXY_CONCURRENT_ROUTING_PREVIEW_KEY = "codex-switch:local-proxy-concurrent-routing";
const LOCAL_PROXY_CONCURRENT_GROUP_PREVIEW_KEY = "codex-switch:local-proxy-concurrent-group";
const LOCAL_PROXY_CUSTOM_PRIORITY_PREVIEW_KEY = "codex-switch:local-proxy-custom-priority";
const LOCAL_PROXY_CUSTOM_THRESHOLD_PREVIEW_KEY = "codex-switch:local-proxy-custom-threshold";
const LOCAL_PROXY_GLOBAL_THRESHOLD_PREVIEW_KEY = "codex-switch:local-proxy-global-threshold";
const LOCAL_PROXY_AUTO_DISABLE_UNREACHABLE_PREVIEW_KEY = "codex-switch:local-proxy-auto-disable-unreachable";
const SYSTEM_PROMPT_FILTER_PREVIEW_KEY = "codex-switch:system-prompt-filter";
const SYSTEM_PROMPT_FILTER_RULES_PREVIEW_KEY = "codex-switch:system-prompt-filter-rules";
const SYSTEM_PROMPT_INJECTION_PREVIEW_KEY = "codex-switch:system-prompt-injection";
const SYSTEM_PROMPT_INJECTION_PROMPTS_PREVIEW_KEY = "codex-switch:system-prompt-injection-prompts";
const LOCAL_PROXY_LISTEN_ALL_INTERFACES_PREVIEW_KEY = "codex-switch:local-proxy-listen-all-interfaces";
const LOCAL_PROXY_PORT_PREVIEW_KEY = "codex-switch:local-proxy-port";
const WEB_PROXY_LISTEN_ALL_INTERFACES_PREVIEW_KEY = "codex-switch:web-proxy-listen-all-interfaces";
const LOCAL_PROXY_IMAGE_ACCOUNT_PREVIEW_KEY = "codex-switch:image-generation-account";
const LOCAL_PROXY_IMAGE_INPUT_TARGET_PREVIEW_KEY = "codex-switch:image-input-target";
const LOCAL_PROXY_IMAGE_OUTPUT_TARGET_PREVIEW_KEY = "codex-switch:image-output-target";
const LOCAL_PROXY_OPENAI_AUTH_ACCOUNT_PREVIEW_KEY = "codex-switch:proxy-openai-auth-account";
const TOKEN_USAGE_WEEKS_PREVIEW_KEY = "codex-switch:token-usage-weeks";
const TOKEN_USAGE_REFRESH_PREVIEW_KEY = "codex-switch:token-usage-refresh-seconds";
const CODEX_USAGE_SUMMARY_PREVIEW_KEY = "codex-switch:codex-usage-summary";
const AUTO_DISABLE_STATUS_CODES_PREVIEW_KEY = "codex-switch:auto-disable-status-codes";
const UPSTREAM_429_RETRY_TIMEOUT_PREVIEW_KEY = "codex-switch:upstream-429-retry-timeout";
const SHOW_USAGE_NETWORK_ERRORS_PREVIEW_KEY = "codex-switch:show-usage-network-errors";
const GPT_5_6_SOL_CONTEXT_WINDOW_LEGACY_KEY = "codex-switch:account-table-model-context-window";
const THEME_COLOR_EVENT = "codex-switch:theme-color-changed";
const BUBBLE_RESET_DISPLAY_EVENT = "bubble-reset-display-changed";
const BUBBLE_STYLE_EVENT = "bubble-style-changed";
const LANGUAGE_EVENT = "codex-switch:language-changed";
const TOTP_EVENT = "codex-switch:totp-changed";
const PROVIDERS_EVENT = "codex-switch:providers-changed";
const PROVIDER_BALANCE_EVENT = "codex-switch:provider-balance-refreshed";
const OPEN_SETTINGS_EVENT = "open-settings";
const CCSWITCH_IMPORT_REQUESTED_EVENT = "ccswitch-import-requested";
const DREAM_SKIN_INSTALLED_PREVIEW_KEY = "codex-switch:dream-skin-installed";
const DREAM_SKIN_SESSION_PREVIEW_KEY = "codex-switch:dream-skin-session";
const DREAM_SKIN_THEME_PREVIEW_KEY = "codex-switch:dream-skin-theme";
const DREAM_SKIN_APPEARANCE_PREVIEW_KEY = "codex-switch:dream-skin-appearance";
const DREAM_SKIN_OVERLAY_OPACITY_PREVIEW_KEY = "codex-switch:dream-skin-overlay-opacity";
const DEFAULT_DREAM_SKIN_OVERLAY_OPACITY = 0.8;
const DREAM_SKIN_MARKET_INDEX_URL = "https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-Themes/main/index.json";
const DREAM_SKIN_MARKET_ASSET_ROOT = "https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-Themes/main/";
const DREAM_SKIN_MARKET_REPOSITORY_URL = "https://github.com/BigPizzaV3/CodexPlusPlus-Themes";
const DREAM_SKIN_COMMUNITY_API_ORIGIN = "https://api.dreamskin.cc";
const DREAM_SKIN_PREVIEW_THEME_NAMES: Record<string, string> = Object.fromEntries(
  BUILT_IN_DREAM_SKIN_THEMES.map((theme) => [theme.id, theme.englishName]),
);
const DREAM_SKIN_PREVIEW_THEME_APPEARANCES: Record<string, DreamSkinAppearance> = Object.fromEntries(
  BUILT_IN_DREAM_SKIN_THEMES.map((theme) => [theme.id, theme.appearance]),
);
let updateCheckPromise: Promise<UpdateInfo | null> | null = null;
const providerBalanceRequests = new Map<string, Promise<ProviderBalance>>();

interface ProviderBalanceEventDetail {
  id: string;
  balance: ProviderBalance;
}

function previewDreamSkinStatus(): DreamSkinStatus {
  const installed = window.localStorage.getItem(DREAM_SKIN_INSTALLED_PREVIEW_KEY) === "true";
  const storedSession = window.localStorage.getItem(DREAM_SKIN_SESSION_PREVIEW_KEY);
  const session = !installed ? "notInstalled" : storedSession === "paused" ? "paused" : storedSession === "active" ? "active" : "ready";
  const storedThemeId = window.localStorage.getItem(DREAM_SKIN_THEME_PREVIEW_KEY);
  const activeThemeId = storedThemeId === "preset-arina-hashimoto" ? "preset-rose-reverie" : storedThemeId;
  const storedAppearance = window.localStorage.getItem(DREAM_SKIN_APPEARANCE_PREVIEW_KEY);
  const activeThemeAppearance: DreamSkinAppearance = storedAppearance === "light" || storedAppearance === "dark"
    ? storedAppearance
    : "auto";
  const storedOverlayOpacity = Number(window.localStorage.getItem(DREAM_SKIN_OVERLAY_OPACITY_PREVIEW_KEY));
  const activeThemeOverlayOpacity = Number.isFinite(storedOverlayOpacity)
    ? Math.min(1, Math.max(0, storedOverlayOpacity))
    : DEFAULT_DREAM_SKIN_OVERLAY_OPACITY;
  return {
    supported: true,
    platform: navigator.platform.toLowerCase().includes("mac") ? "macos" : "windows",
    installed,
    runtimeInstalled: installed,
    session,
    activeThemeId,
    activeThemeName: activeThemeId ? DREAM_SKIN_PREVIEW_THEME_NAMES[activeThemeId] ?? "Custom theme" : null,
    activeThemeAppearance,
    activeThemeOverlayOpacity,
    enginePath: installed ? "Preview / CodexDreamSkin" : null,
    savedThemes: [],
  };
}

function previewCloudState(): CloudAuthState {
  const storedBaseUrl = window.localStorage.getItem(CLOUD_BASE_URL_PREVIEW_KEY);
  const baseUrl = (storedBaseUrl ?? DEFAULT_CLOUD_BASE_URL).trim();
  const userEmail = window.localStorage.getItem(CLOUD_USER_PREVIEW_KEY);
  return {
    enabled: baseUrl.length > 0,
    baseUrl: baseUrl || null,
    authenticated: Boolean(baseUrl && userEmail),
    userEmail,
    userId: userEmail ? "preview" : null,
    lastSyncAt: null,
    sessionExpired: false,
  };
}

function normalizeModels(model: string, models: unknown): string[] {
  const normalized: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed && !normalized.includes(trimmed)) normalized.push(trimmed);
  };
  push(model);
  if (Array.isArray(models)) models.forEach(push);
  return normalized;
}

function normalizeModelSubset(models: string[], selected: unknown): string[] {
  if (!Array.isArray(selected)) return [];
  return normalizeModels("", selected).filter((model) => models.includes(model));
}

const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max", "ultra"]);

function normalizeModelReasoningEfforts(models: string[], value: unknown): Provider["modelReasoningEfforts"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Provider["modelReasoningEfforts"] = {};
  for (const model of models) {
    const efforts = (value as Record<string, unknown>)[model];
    if (!Array.isArray(efforts)) continue;
    const valid = [...new Set(efforts.filter((effort): effort is ReasoningEffort => (
      typeof effort === "string" && REASONING_EFFORTS.has(effort)
    )))];
    if (valid.length) normalized[model] = valid;
  }
  return normalized;
}

function normalizeModelContextWindows(models: string[], value: unknown): Provider["modelContextWindows"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Provider["modelContextWindows"] = {};
  for (const model of models) {
    const contextWindow = (value as Record<string, unknown>)[model];
    if (typeof contextWindow === "number" && Number.isSafeInteger(contextWindow) && contextWindow > 0) {
      normalized[model] = contextWindow;
    }
  }
  return normalized;
}

function normalizeModelApiFormats(models: string[], value: unknown): Provider["modelApiFormats"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Provider["modelApiFormats"] = {};
  for (const model of models) {
    const apiFormat = (value as Record<string, unknown>)[model];
    if (apiFormat === "openaiResponses" || apiFormat === "openaiChat") {
      normalized[model] = apiFormat;
    }
  }
  return normalized;
}

function readPreviewProviders(): Provider[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PROVIDERS_PREVIEW_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((provider): provider is Provider & { models?: unknown } => Boolean(
      provider
      && typeof provider === "object"
      && "id" in provider
      && "name" in provider
      && "baseUrl" in provider
      && "model" in provider,
    )).map((provider) => {
      const kind = provider.kind === "openai" ? "openai" : "custom";
      const storedModel = provider.model.trim();
      const selectedModel = kind === "openai" && !storedModel
        ? DEFAULT_OPENAI_PROVIDER_MODEL
        : storedModel;
      const models = normalizeModels(selectedModel, provider.models);
      return {
        ...provider,
        modelTokenCosts: provider.modelTokenCosts ?? loadStoredModelTokenCosts()[provider.id] ?? {},
        kind,
        group: kind === "custom" && typeof provider.group === "string" ? provider.group.trim() : "",
        model: models.includes(selectedModel) ? selectedModel : (models[0] ?? ""),
        models,
        modelReasoningEfforts: normalizeModelReasoningEfforts(models, provider.modelReasoningEfforts),
        modelContextWindows: normalizeModelContextWindows(models, provider.modelContextWindows),
        modelApiFormats: normalizeModelApiFormats(models, provider.modelApiFormats),
        imageInputModels: normalizeModelSubset(models, provider.imageInputModels),
        imageInputModelsConfigured: Boolean(provider.imageInputModelsConfigured),
        contextWindow: provider.contextWindow ?? null,
        modelSelectionControlledByCodex: kind === "openai"
          ? true
          : Boolean(provider.modelSelectionControlledByCodex),
        apiFormat: kind === "openai" ? "openaiResponses" : provider.apiFormat,
        autoSwitchEnabled: kind === "custom" && Boolean(provider.autoSwitchEnabled),
        balancePlatform: provider.balancePlatform ?? null,
        balanceQueryUrl: provider.balanceQueryUrl ?? null,
        balanceQueryUsesApiKey: provider.balanceQueryUsesApiKey !== false,
        hasBalanceQueryToken: Boolean(provider.hasBalanceQueryToken),
        walletQueryUrl: provider.walletQueryUrl ?? null,
        hasWalletQueryToken: Boolean(provider.hasWalletQueryToken),
        walletUsername: provider.walletUsername ?? null,
        hasWalletLoginCredentials: Boolean(provider.hasWalletLoginCredentials),
      };
    });
  } catch {
    return [];
  }
}

function writePreviewProviders(providers: Provider[]) {
  window.localStorage.setItem(PROVIDERS_PREVIEW_KEY, JSON.stringify(providers));
  window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
}

function previewProviderId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function previewLocalProxyStatus(): LocalProxyStatus {
  const configuredPort = Number(window.localStorage.getItem(LOCAL_PROXY_PORT_PREVIEW_KEY));
  const configuredGlobalThreshold = Number(
    window.localStorage.getItem(LOCAL_PROXY_GLOBAL_THRESHOLD_PREVIEW_KEY),
  );
  const port = Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65_535
    ? configuredPort
    : 0;
  const running = port > 0 && window.localStorage.getItem(LOCAL_PROXY_PREVIEW_KEY) === "true";
  const storedTier = window.localStorage.getItem(LOCAL_PROXY_SERVICE_TIER_PREVIEW_KEY);
  const savedTier = storedTier === "ultrafast" || storedTier === "priority" ? storedTier : "default";
  const legacyTier = window.localStorage.getItem(LOCAL_PROXY_FAST_MODE_PREVIEW_KEY) === "true"
    ? "priority" : "default";
  const serviceTier = running ? (storedTier === null ? legacyTier : savedTier) : "default";
  return {
    running,
    serviceTier,
    fastModeEnabled: serviceTier !== "default",
    fastModeAvailable: port > 0 && window.localStorage.getItem(LOCAL_PROXY_PREVIEW_KEY) === "true",
    address: window.localStorage.getItem(LOCAL_PROXY_LISTEN_ALL_INTERFACES_PREVIEW_KEY) === "true" ? "0.0.0.0" : "127.0.0.1",
    port,
    baseUrl: port > 0 ? `http://127.0.0.1:${port}/v1` : "",
    autoSwitchOnQuotaExhaustion: window.localStorage.getItem(LOCAL_PROXY_AUTO_SWITCH_PREVIEW_KEY) === "true",
    concurrentAccountRoutingEnabled: window.localStorage.getItem(LOCAL_PROXY_CONCURRENT_ROUTING_PREVIEW_KEY) === "true",
    concurrentAccountGroup: window.localStorage.getItem(LOCAL_PROXY_CONCURRENT_GROUP_PREVIEW_KEY),
    customAutoSwitchPriorityEnabled: window.localStorage.getItem(LOCAL_PROXY_CUSTOM_PRIORITY_PREVIEW_KEY) === "true",
    customAutoSwitchThresholdEnabled: window.localStorage.getItem(LOCAL_PROXY_CUSTOM_THRESHOLD_PREVIEW_KEY) === "true",
    globalAutoSwitchThreshold: Number.isFinite(configuredGlobalThreshold)
      && configuredGlobalThreshold >= 0 && configuredGlobalThreshold <= 100
      ? configuredGlobalThreshold : 0,
    autoDisableUnreachableAccounts: window.localStorage.getItem(LOCAL_PROXY_AUTO_DISABLE_UNREACHABLE_PREVIEW_KEY) === "true",
    systemPromptFilterEnabled: window.localStorage.getItem(SYSTEM_PROMPT_FILTER_PREVIEW_KEY) === "true",
    systemPromptFilterRules: readPreviewSystemPromptFilterRules(),
    systemPromptInjectionEnabled: window.localStorage.getItem(SYSTEM_PROMPT_INJECTION_PREVIEW_KEY) === "true",
    systemPromptInjectionPrompts: readPreviewSystemPromptInjectionPrompts(),
    listenOnAllInterfaces: window.localStorage.getItem(LOCAL_PROXY_LISTEN_ALL_INTERFACES_PREVIEW_KEY) === "true",
    hasLanApiKey: previewHasLocalProxyLanApiKey(),
    imageGenerationAccountId: window.localStorage.getItem(LOCAL_PROXY_IMAGE_ACCOUNT_PREVIEW_KEY),
    imageInputTarget: readPreviewImageModelTarget(LOCAL_PROXY_IMAGE_INPUT_TARGET_PREVIEW_KEY),
    imageOutputTarget: readPreviewImageModelTarget(LOCAL_PROXY_IMAGE_OUTPUT_TARGET_PREVIEW_KEY),
    openaiAuthAccountId: window.localStorage.getItem(LOCAL_PROXY_OPENAI_AUTH_ACCOUNT_PREVIEW_KEY),
  };
}

function readPreviewImageModelTarget(key: string): LocalProxyStatus["imageInputTarget"] {
  const stored = window.localStorage.getItem(key);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as unknown;
    if (!value || typeof value !== "object" || !("kind" in value)) return null;
    if (value.kind === "official" && "accountId" in value && typeof value.accountId === "string") {
      return { kind: "official", accountId: value.accountId };
    }
    if (value.kind === "provider" && "providerId" in value && "model" in value
      && typeof value.providerId === "string" && typeof value.model === "string") {
      return { kind: "provider", providerId: value.providerId, model: value.model };
    }
  } catch {
    return null;
  }
  return null;
}

export async function loadDashboard(): Promise<{ accounts: Account[]; info: AppInfo }> {
  if (!hasLocalBackend) {
    return { accounts: structuredClone(DEMO_ACCOUNTS), info: DEMO_INFO };
  }
  const [accounts, info] = await Promise.all([
    invoke<Account[]>("list_accounts"),
    invoke<AppInfo>("get_app_info"),
  ]);
  return { accounts, info };
}

function previewFloatingBubbleEnabled() {
  return window.localStorage.getItem(FLOATING_BUBBLE_PREVIEW_KEY) !== "false";
}

function previewBubbleStyle(): BubbleStyle {
  return window.localStorage.getItem(BUBBLE_STYLE_PREVIEW_KEY) === "glass" ? "glass" : "classic";
}

function previewAutoDisableStatusCodes() {
  const saved = window.localStorage.getItem(AUTO_DISABLE_STATUS_CODES_PREVIEW_KEY);
  if (saved === null) return [...DEFAULT_AUTO_DISABLE_STATUS_CODES];
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [...DEFAULT_AUTO_DISABLE_STATUS_CODES];
    return [...new Set(parsed.filter((status): status is number => (
      Number.isInteger(status) && status >= 100 && status <= 599
    )))].sort((left, right) => left - right);
  } catch {
    return [...DEFAULT_AUTO_DISABLE_STATUS_CODES];
  }
}

function previewUpstream429RetryTimeoutSeconds() {
  const value = Number(window.localStorage.getItem(UPSTREAM_429_RETRY_TIMEOUT_PREVIEW_KEY));
  return Number.isInteger(value)
    && value >= MIN_UPSTREAM_429_RETRY_TIMEOUT_SECONDS
    && value <= MAX_UPSTREAM_429_RETRY_TIMEOUT_SECONDS
    ? value
    : DEFAULT_UPSTREAM_429_RETRY_TIMEOUT_SECONDS;
}

function legacyGpt56SolContextWindow(): number | null {
  try {
    const contextWindowK = Number(window.localStorage.getItem(GPT_5_6_SOL_CONTEXT_WINDOW_LEGACY_KEY));
    const contextWindow = contextWindowK * 1_000;
    if (contextWindow === 256_000) return DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW;
    return Number.isSafeInteger(contextWindow)
      && contextWindow >= MIN_GPT_5_6_SOL_CONTEXT_WINDOW
      && contextWindow <= MAX_GPT_5_6_SOL_CONTEXT_WINDOW
      ? contextWindow
      : null;
  } catch {
    return null;
  }
}

export async function loadAppSettings(): Promise<AppSettings> {
  if (!hasLocalBackend) {
    return {
      codexHome: null,
      codexHomes: [],
      launchAtStartup: window.localStorage.getItem(LAUNCH_AT_STARTUP_PREVIEW_KEY) !== "false",
      closeToTray: window.localStorage.getItem(CLOSE_TO_TRAY_PREVIEW_KEY) !== "false",
      nonProxyEnhancementsEnabled: window.localStorage.getItem(NON_PROXY_ENHANCEMENTS_PREVIEW_KEY) !== "false",
      floatingBubbleEnabled: previewFloatingBubbleEnabled(),
      privacyMode: window.localStorage.getItem(PRIVACY_MODE_PREVIEW_KEY) !== "false",
      hideAccountNotes: window.localStorage.getItem(HIDE_ACCOUNT_NOTES_PREVIEW_KEY) === "true",
      bubbleResetDisplay: window.localStorage.getItem(BUBBLE_RESET_DISPLAY_PREVIEW_KEY) === "resetAt" ? "resetAt" : "countdown",
      bubbleStyle: previewBubbleStyle(),
      themeColor: normalizeThemeColor(window.localStorage.getItem(THEME_COLOR_PREVIEW_KEY) ?? DEFAULT_THEME_COLOR),
      cloudBaseUrl: window.localStorage.getItem(CLOUD_BASE_URL_PREVIEW_KEY) ?? DEFAULT_CLOUD_BASE_URL,
      showCustomCloudServer: false,
      tokenUsageWeeks: Number(window.localStorage.getItem(TOKEN_USAGE_WEEKS_PREVIEW_KEY)) || 20,
      tokenUsageRefreshSeconds: Number(window.localStorage.getItem(TOKEN_USAGE_REFRESH_PREVIEW_KEY)) || 60,
      codexUsageSummaryEnabled: window.localStorage.getItem(CODEX_USAGE_SUMMARY_PREVIEW_KEY) !== "false",
      autoDisableStatusCodes: previewAutoDisableStatusCodes(),
      upstream429RetryTimeoutSeconds: previewUpstream429RetryTimeoutSeconds(),
      showUsageNetworkErrors: window.localStorage.getItem(SHOW_USAGE_NETWORK_ERRORS_PREVIEW_KEY) === "true",
      gpt56SolContextWindow: legacyGpt56SolContextWindow() ?? DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW,
      webProxyPort: previewLocalProxyStatus().port || null,
      webProxyListenOnAllInterfaces:
        window.localStorage.getItem(WEB_PROXY_LISTEN_ALL_INTERFACES_PREVIEW_KEY) === "true",
      networkProxy: {
        enabled: window.localStorage.getItem(NETWORK_PROXY_ENABLED_PREVIEW_KEY) === "true",
        proxyUrl: window.localStorage.getItem(NETWORK_PROXY_URL_PREVIEW_KEY) ?? "",
        proxyPort: Number(window.localStorage.getItem(NETWORK_PROXY_PORT_PREVIEW_KEY)) || null,
      },
      providerGroups: previewProviderGroups(),
      accountGroups: previewAccountGroups(),
      thirdPartyAppWrite: previewThirdPartyAppWriteSettings(),
      claudeCodeWriteTarget: previewClaudeCodeWriteTarget(),
    };
  }
  return invoke<AppSettings>("get_app_settings");
}

function previewClaudeCodeWriteTarget(): ClaudeCodeWriteTarget {
  const value = window.localStorage.getItem(CLAUDE_CODE_WRITE_TARGET_PREVIEW_KEY);
  return value === "all" || value === "claudeCode" ? value : "codex";
}

function previewThirdPartyAppWriteSettings(): ThirdPartyAppWriteSettings {
  const serialized = window.localStorage.getItem(THIRD_PARTY_APP_WRITE_PREVIEW_KEY);
  if (!serialized) {
    return normalizeThirdPartyAppWriteSettings(undefined, previewClaudeCodeWriteTarget());
  }
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== "object") return normalizeThirdPartyAppWriteSettings(undefined);
    const record = value as Record<string, unknown>;
    const rawApps = record.apps && typeof record.apps === "object"
      ? record.apps as Record<string, unknown>
      : {};
    const apps: Partial<ThirdPartyAppWriteSettings["apps"]> = {};
    for (const appId of THIRD_PARTY_APP_IDS) {
      if (typeof rawApps[appId] === "boolean") apps[appId] = rawApps[appId];
    }
    return normalizeThirdPartyAppWriteSettings({
      enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
      writeCodex: typeof record.writeCodex === "boolean" ? record.writeCodex : undefined,
      claudeSubagentModel: record.claudeSubagentModel === "luna"
        || record.claudeSubagentModel === "terra" ? record.claudeSubagentModel : "sol",
      apps,
    });
  } catch {
    return normalizeThirdPartyAppWriteSettings(undefined, previewClaudeCodeWriteTarget());
  }
}

export async function updateThirdPartyAppWriteSettings(
  settings: ThirdPartyAppWriteSettings,
): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(THIRD_PARTY_APP_WRITE_PREVIEW_KEY, JSON.stringify(settings));
    return loadAppSettings();
  }
  return invoke<AppSettings>("set_third_party_app_write_settings", { settings });
}

export async function chooseCodexHome(defaultPath?: string): Promise<string | null> {
  if (!isDesktopApp) return null;
  const selected = await open({
    title: "Codex Home",
    multiple: false,
    directory: true,
    defaultPath: defaultPath || undefined,
  });
  return typeof selected === "string" ? selected : null;
}

export async function updateCodexHome(path: string | null): Promise<AppSettings> {
  if (!isDesktopApp) return loadAppSettings();
  return invoke<AppSettings>("set_codex_home", { path });
}

export async function updateCodexHomes(homes: CodexHomeEntry[]): Promise<AppSettings> {
  if (!isDesktopApp) return loadAppSettings();
  return invoke<AppSettings>("set_codex_homes", { homes });
}

export async function loadCodexHomePresets(baseUrl: string): Promise<CodexHomePreset[]> {
  const platform = navigator.platform.toLowerCase().includes("mac") ? "macos" : "windows";
  if (hasLocalBackend) return invoke<CodexHomePreset[]>("fetch_cloud_home_presets", { baseUrl, platform });
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/codex-home-presets?platform=${platform}`,
    { headers: { Accept: "application/json" }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<CodexHomePreset[]>;
}

export async function loadGpt56SolContextWindow(): Promise<number> {
  const settings = await loadAppSettings();
  const savedContextWindow = settings.gpt56SolContextWindow ?? DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW;
  const legacyContextWindow = legacyGpt56SolContextWindow();
  if (!hasLocalBackend || legacyContextWindow === null) return savedContextWindow;
  const migrated = await invoke<AppSettings>("set_gpt_5_6_sol_context_window", {
    contextWindow: legacyContextWindow,
  });
  try {
    window.localStorage.removeItem(GPT_5_6_SOL_CONTEXT_WINDOW_LEGACY_KEY);
  } catch {
    // The backend setting remains authoritative when browser storage is unavailable.
  }
  return migrated.gpt56SolContextWindow ?? legacyContextWindow;
}

export async function updateGpt56SolContextWindow(contextWindow: number): Promise<number> {
  if (!Number.isSafeInteger(contextWindow)
    || contextWindow < MIN_GPT_5_6_SOL_CONTEXT_WINDOW
    || contextWindow > MAX_GPT_5_6_SOL_CONTEXT_WINDOW) {
    throw new Error("Context window must be between 1K and 1050K");
  }
  if (!hasLocalBackend) {
    window.localStorage.setItem(GPT_5_6_SOL_CONTEXT_WINDOW_LEGACY_KEY, String(contextWindow / 1_000));
    return contextWindow;
  }
  const settings = await invoke<AppSettings>("set_gpt_5_6_sol_context_window", { contextWindow });
  return settings.gpt56SolContextWindow ?? contextWindow;
}

export async function loadProviders(): Promise<Provider[]> {
  if (!hasLocalBackend) {
    const proxyRunning = previewLocalProxyStatus().running;
    const providers = readPreviewProviders();
    const normalized = providers.map((provider) => ({
      ...provider,
      active: proxyRunning && provider.active,
      supportsDirectSwitch: proxyRunning,
    }));
    if (!proxyRunning && providers.some((provider) => provider.active)) {
      writePreviewProviders(normalized);
    }
    return normalized;
  }
  const providers = await invoke<Provider[]>("list_providers");
  const storedCosts = loadStoredModelTokenCosts();
  return providers.map((provider) => ({
    ...provider,
    modelTokenCosts: provider.modelTokenCosts ?? storedCosts[provider.id] ?? {},
  }));
}

function readPreviewAggregateApis(): AggregateApi[] {
  try {
    const stored = window.localStorage.getItem(AGGREGATE_APIS_PREVIEW_KEY) ?? "[]";
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((aggregate): aggregate is AggregateApi => Boolean(
      aggregate
      && typeof aggregate === "object"
      && "id" in aggregate
      && "name" in aggregate
      && "model" in aggregate
      && "memberProviderIds" in aggregate,
    ));
  } catch {
    return [];
  }
}

function writePreviewAggregateApis(aggregates: AggregateApi[]) {
  window.localStorage.setItem(AGGREGATE_APIS_PREVIEW_KEY, JSON.stringify(aggregates));
  window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
}

export async function loadAggregateApis(): Promise<AggregateApi[]> {
  if (!hasLocalBackend) return readPreviewAggregateApis();
  return invoke<AggregateApi[]>("list_aggregate_apis");
}

export async function saveAggregateApiProfile(input: AggregateApiInput): Promise<AggregateApi> {
  if (!hasLocalBackend) {
    const providers = readPreviewProviders();
    const memberIds = [...new Set(input.memberProviderIds)];
    if (memberIds.length < 2) throw new Error("Select at least two APIs for the aggregate");
    const members = memberIds.map((id) => providers.find((provider) => provider.id === id));
    if (members.some((provider) => !provider)) throw new Error("Provider does not exist");
    if (members.some((provider) => !provider?.models.includes(input.model))) {
      throw new Error("Every API in an aggregate must support the selected model");
    }
    const aggregates = readPreviewAggregateApis();
    const index = input.id ? aggregates.findIndex((aggregate) => aggregate.id === input.id) : -1;
    const aggregate: AggregateApi = {
      ...input,
      id: input.id ?? previewProviderId(),
      memberProviderIds: memberIds,
      active: index >= 0 && aggregates[index].active && input.enabled,
      memberConversationCounts: index >= 0 ? aggregates[index].memberConversationCounts ?? {} : {},
    };
    if (index >= 0) aggregates[index] = aggregate;
    else aggregates.push(aggregate);
    writePreviewAggregateApis(aggregates);
    return aggregate;
  }
  return invoke<AggregateApi>("save_aggregate_api", { aggregate: input });
}

export async function activateAggregateApi(id: string): Promise<void> {
  if (!hasLocalBackend) {
    if (!previewLocalProxyStatus().running) {
      throw new Error(
        "Third-party Providers require the local proxy. Start the local proxy before switching Provider.",
      );
    }
    const aggregates = readPreviewAggregateApis();
    const selected = aggregates.find((aggregate) => aggregate.id === id);
    if (!selected) throw new Error("Aggregate API does not exist");
    if (!selected.enabled) throw new Error("Enable the aggregate API before using it");
    writePreviewProviders(readPreviewProviders().map((provider) => ({ ...provider, active: false })));
    writePreviewAggregateApis(aggregates.map((aggregate) => ({
      ...aggregate,
      active: aggregate.id === id,
    })));
    return;
  }
  await invoke("switch_aggregate_api", { id });
}

export async function removeAggregateApi(id: string): Promise<void> {
  if (!hasLocalBackend) {
    writePreviewAggregateApis(readPreviewAggregateApis().filter((aggregate) => aggregate.id !== id));
    return;
  }
  await invoke("delete_aggregate_api", { id });
}

export async function saveProviderProfile(provider: ProviderInput): Promise<Provider> {
  if (!hasLocalBackend) {
    const providers = readPreviewProviders();
    const index = provider.id ? providers.findIndex((item) => item.id === provider.id) : -1;
    const existing = index >= 0 ? providers[index] : null;
    const hasApiKey = Boolean(provider.apiKey?.trim() || existing?.hasApiKey);
    const kind = provider.kind === "openai" ? "openai" : "custom";
    const allowsMissingApiKey = isAntigravityProvider(provider)
      || findProviderPreset(provider)?.apiKeyRequired === false;
    if (kind === "custom" && !hasApiKey && !allowsMissingApiKey) {
      throw new Error("API key is required for a new provider");
    }
    const requestedModel = provider.model.trim();
    const selectedModel = kind === "openai" && !requestedModel
      ? DEFAULT_OPENAI_PROVIDER_MODEL
      : requestedModel;
    const models = normalizeModels(selectedModel, provider.models);
    const model = selectedModel || (models[0] ?? "");
    const apiFormat = kind === "openai" ? "openaiResponses" : provider.apiFormat;
    const next: Provider = {
      id: existing?.id ?? provider.id ?? previewProviderId(),
      kind,
      name: provider.name.trim(),
      group: kind === "custom" ? provider.group?.trim() || existing?.group || "" : "",
      baseUrl: provider.baseUrl.trim().replace(/\/+$/, ""),
      model,
      models,
      modelReasoningEfforts: normalizeModelReasoningEfforts(models, provider.modelReasoningEfforts),
      modelContextWindows: normalizeModelContextWindows(models, provider.modelContextWindows),
      modelApiFormats: normalizeModelApiFormats(models, provider.modelApiFormats),
      modelTokenCosts: provider.modelTokenCosts ?? existing?.modelTokenCosts ?? {},
      imageInputModels: normalizeModelSubset(models, provider.imageInputModels),
      imageInputModelsConfigured: provider.imageInputModelsConfigured
        ?? existing?.imageInputModelsConfigured
        ?? false,
      contextWindow: provider.contextWindow ?? null,
      modelSelectionControlledByCodex: kind === "openai"
        ? true
        : provider.modelSelectionControlledByCodex,
      fastModeEnabled: kind === "openai" ? true : (provider.fastModeEnabled ?? true),
      apiFormat,
      active: existing?.active ?? false,
      autoSwitchEnabled: kind === "custom" && Boolean(existing?.autoSwitchEnabled),
      hasApiKey,
      supportsDirectSwitch: previewLocalProxyStatus().running,
      balancePlatform: provider.balancePlatform ?? null,
      balanceQueryUrl: provider.balanceQueryUrl ?? null,
      balanceQueryUsesApiKey: provider.balanceQueryUsesApiKey !== false,
      hasBalanceQueryToken: Boolean(provider.balanceQueryToken?.trim() || (
        existing?.hasBalanceQueryToken && provider.balanceQueryUsesApiKey === false
      )),
      walletQueryUrl: provider.walletQueryUrl ?? null,
      hasWalletQueryToken: Boolean(provider.walletQueryToken?.trim() || (
        existing?.hasWalletQueryToken && provider.walletQueryUrl === existing.walletQueryUrl
      )),
      walletUsername: provider.walletUsername?.trim() || existing?.walletUsername || null,
      hasWalletLoginCredentials: Boolean(
        (provider.walletUsername?.trim() && provider.walletPassword)
        || (existing?.hasWalletLoginCredentials
          && (!provider.walletUsername?.trim()
            || provider.walletUsername.trim() === existing.walletUsername)
          && provider.walletQueryUrl === existing.walletQueryUrl),
      ),
    };
    if (index >= 0) providers[index] = next;
    else providers.push(next);
    writePreviewProviders(providers);
    return next;
  }
  const saved = await invoke<Provider>("save_provider", { provider });
  const storedCosts = loadStoredModelTokenCosts()[saved.id] ?? {};
  const modelTokenCosts = provider.modelTokenCosts ?? storedCosts;
  if (provider.modelTokenCosts) persistStoredModelTokenCosts(saved.id, modelTokenCosts);
  return { ...saved, modelTokenCosts };
}

function readPreviewSystemPromptRules(key: string): SystemPromptRule[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((entry): SystemPromptRule[] => {
      if (typeof entry === "string") return [{ name: "", text: entry, enabled: true }];
      if (!entry || typeof entry !== "object") return [];
      const value = entry as { name?: unknown; text?: unknown; enabled?: unknown };
      return typeof value.text === "string"
        ? [{
            name: typeof value.name === "string" ? value.name : "",
            text: value.text,
            enabled: value.enabled !== false,
          }]
        : [];
    });
  } catch {
    return [];
  }
}

function readPreviewSystemPromptFilterRules(): SystemPromptRule[] {
  return readPreviewSystemPromptRules(SYSTEM_PROMPT_FILTER_RULES_PREVIEW_KEY);
}

function readPreviewSystemPromptInjectionPrompts(): SystemPromptRule[] {
  return readPreviewSystemPromptRules(SYSTEM_PROMPT_INJECTION_PROMPTS_PREVIEW_KEY);
}

export async function fetchDeepSeekModels(
  baseUrl: string,
  apiKey?: string,
  providerId?: string,
): Promise<string[]> {
  if (!hasLocalBackend) {
    return ["deepseek-v4-flash", "deepseek-v4-pro"];
  }
  return invoke<string[]>("fetch_deepseek_models", {
    baseUrl,
    apiKey: apiKey?.trim() || null,
    providerId: providerId ?? null,
  });
}

export async function fetchAntigravityModels(
  baseUrl: string,
  apiKey?: string,
  providerId?: string,
): Promise<string[]> {
  if (!hasLocalBackend) {
    return ANTIGRAVITY_FALLBACK_MODELS;
  }
  return invoke<string[]>("fetch_antigravity_models", {
    baseUrl,
    apiKey: apiKey?.trim() || null,
    providerId: providerId ?? null,
  });
}

export async function fetchGrokModels(
  baseUrl: string,
  apiKey?: string,
  providerId?: string,
): Promise<string[]> {
  if (!hasLocalBackend) {
    return GROK_FALLBACK_MODELS;
  }
  return invoke<string[]>("fetch_grok_models", {
    baseUrl,
    apiKey: apiKey?.trim() || null,
    providerId: providerId ?? null,
  });
}

export async function fetchClaudeCodeModels(
  baseUrl: string,
  apiKey?: string,
  providerId?: string,
): Promise<string[]> {
  if (!hasLocalBackend) {
    return CLAUDE_CODE_FALLBACK_MODELS;
  }
  return invoke<string[]>("fetch_claude_code_models", {
    baseUrl,
    apiKey: apiKey?.trim() || null,
    providerId: providerId ?? null,
  });
}

export interface PresetModelQuery {
  presetId: string;
  baseUrl: string;
  apiKey?: string;
  providerId?: string;
}

export async function fetchPresetModels(
  request: PresetModelQuery,
  fallbackModels: string[],
): Promise<string[]> {
  if (!hasLocalBackend) return fallbackModels;
  return invoke<string[]>("fetch_preset_models", {
    request: {
      presetId: request.presetId,
      baseUrl: request.baseUrl,
      apiKey: request.apiKey?.trim() || null,
      providerId: request.providerId ?? null,
    },
  });
}

export async function fetchRelayModels(baseUrl: string, apiKey: string, providerId?: string): Promise<string[]> {
  if (!hasLocalBackend) {
    return [DEFAULT_OPENAI_PROVIDER_MODEL, "gpt-5.6-sol", "gpt-5.4"];
  }
  return invoke<string[]>("fetch_relay_models", {
    baseUrl,
    apiKey: apiKey.trim(),
    providerId: providerId ?? null,
  });
}

export async function testProviderConnectivity(id: string): Promise<void> {
  if (!isDesktopApp) return;
  await invoke("test_provider_connectivity", { id });
}

export async function detectRelayPlatform(
  baseUrl: string,
  apiKey: string,
): Promise<ProviderBalancePlatform | null> {
  if (!hasLocalBackend) return null;
  return invoke<ProviderBalancePlatform | null>("detect_relay_platform", {
    baseUrl,
    apiKey: apiKey.trim(),
  });
}

async function performProviderBalanceQuery(id: string): Promise<ProviderBalance> {
  if (!hasLocalBackend) {
    const provider = readPreviewProviders().find((item) => item.id === id);
    if (!provider) throw new Error("Provider does not exist");
    if (!provider.balancePlatform) throw new Error("Provider balance query is not enabled");
    return {
      apiAmount: provider.balancePlatform === "newApi" ? 108.08 : provider.balancePlatform === "deepSeek" ? 88.8 : 42.5,
      apiUnit: provider.balancePlatform === "deepSeek" ? "CNY" : "USD",
      apiUnlimited: false,
      walletAmount: provider.balancePlatform !== "deepSeek" && (provider.hasWalletQueryToken || provider.hasWalletLoginCredentials) ? 66.6 : null,
      walletUnit: "USD",
      walletError: null,
      balanceItems: provider.balancePlatform === "deepSeek"
        ? [{ amount: 88.8, unit: "CNY" }, { amount: 12.5, unit: "USD" }]
        : [],
      queriedAt: Math.floor(Date.now() / 1000),
    };
  }
  return invoke<ProviderBalance>("query_provider_balance", { id });
}

export function queryProviderBalance(id: string): Promise<ProviderBalance> {
  const pending = providerBalanceRequests.get(id);
  if (pending) return pending;

  const request = performProviderBalanceQuery(id)
    .then((balance) => {
      window.dispatchEvent(new CustomEvent<ProviderBalanceEventDetail>(
        PROVIDER_BALANCE_EVENT,
        { detail: { id, balance } },
      ));
      return balance;
    })
    .finally(() => providerBalanceRequests.delete(id));
  providerBalanceRequests.set(id, request);
  return request;
}

export async function queryProviderUsage(id: string): Promise<UsageSummary> {
  if (!hasLocalBackend) {
    return {
      primary: { usedPercent: 18, remainingPercent: 82, resetsAt: Math.floor(Date.now() / 1000) + 3_600, windowMinutes: 300 },
      secondary: { usedPercent: 34, remainingPercent: 66, resetsAt: Math.floor(Date.now() / 1000) + 86_400, windowMinutes: 10_080 },
      fetchedAt: new Date().toISOString(),
      error: null,
    };
  }
  return invoke<UsageSummary>("query_provider_usage", { id });
}

export function subscribeToProviderBalance(
  id: string,
  onBalance: (balance: ProviderBalance) => void,
): () => void {
  const handleBalance = (event: Event) => {
    const detail = (event as CustomEvent<ProviderBalanceEventDetail>).detail;
    if (detail?.id === id) onBalance(detail.balance);
  };
  window.addEventListener(PROVIDER_BALANCE_EVENT, handleBalance);
  return () => window.removeEventListener(PROVIDER_BALANCE_EVENT, handleBalance);
}

export async function activateProvider(id: string): Promise<void> {
  if (!hasLocalBackend) {
    const providers = readPreviewProviders();
    const selected = providers.find((provider) => provider.id === id);
    if (!selected) throw new Error("Provider does not exist");
    if (!previewLocalProxyStatus().running) {
      throw new Error("Third-party Providers require the local proxy. Start the local proxy before switching Provider.");
    }
    window.localStorage.setItem(LOCAL_PROXY_CONCURRENT_ROUTING_PREVIEW_KEY, "false");
    writePreviewProviders(providers.map((provider) => ({ ...provider, active: provider.id === id })));
    writePreviewAggregateApis(readPreviewAggregateApis().map((aggregate) => ({
      ...aggregate,
      active: false,
    })));
    return;
  }
  await invoke("switch_provider", { id });
}

function previewProviderGroups(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PROVIDER_GROUPS_PREVIEW_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((group): group is string => typeof group === "string") : [];
  } catch {
    return [];
  }
}

function previewAccountGroups(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ACCOUNT_GROUPS_PREVIEW_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((group): group is string => typeof group === "string") : [];
  } catch {
    return [];
  }
}

export async function updateAccountGroups(groups: string[]): Promise<string[]> {
  const normalized = [...new Set(groups.map((group) => group.trim()).filter(Boolean))];
  if (!hasLocalBackend) {
    window.localStorage.setItem(ACCOUNT_GROUPS_PREVIEW_KEY, JSON.stringify(normalized));
    return normalized;
  }
  return invoke<string[]>("set_account_groups", { groups: normalized });
}

export async function updateProviderGroups(groups: string[]): Promise<string[]> {
  const normalized = [...new Set(groups.map((group) => group.trim()).filter(Boolean))];
  if (!hasLocalBackend) {
    window.localStorage.setItem(PROVIDER_GROUPS_PREVIEW_KEY, JSON.stringify(normalized));
    return normalized;
  }
  return invoke<string[]>("set_provider_groups", { groups: normalized });
}

export async function activateProviderGroup(group: string): Promise<void> {
  const normalizedGroup = group.trim();
  if (!normalizedGroup) throw new Error("Select a Provider group");
  if (!hasLocalBackend) {
    const providers = readPreviewProviders();
    if (!providers.some((provider) => provider.kind === "custom" && provider.group === normalizedGroup)) {
      throw new Error("Provider group does not contain any available APIs");
    }
    if (!previewLocalProxyStatus().running) {
      throw new Error(
        "Third-party Providers require the local proxy. Start the local proxy before switching Provider.",
      );
    }
    writePreviewProviders(providers.map((provider) => ({
      ...provider,
      active: provider.kind === "custom" && provider.group === normalizedGroup,
    })));
    return;
  }
  await invoke("switch_provider_group", { group: normalizedGroup });
}

export async function switchProviderModel(id: string, model: string): Promise<Provider> {
  if (!hasLocalBackend) {
    const providers = readPreviewProviders();
    const index = providers.findIndex((provider) => provider.id === id);
    if (index < 0) throw new Error("Provider does not exist");
    const selectedModel = model.trim();
    if (!selectedModel) throw new Error("Model is required");
    const provider = providers[index];
    const models = normalizeModels(selectedModel, provider.models);
    providers[index] = { ...provider, model: selectedModel, models };
    writePreviewProviders(providers);
    return providers[index];
  }
  return invoke<Provider>("switch_provider_model", { id, model });
}

export async function setProviderModelControl(id: string, controlledByCodex: boolean): Promise<Provider> {
  if (!hasLocalBackend) {
    const providers = readPreviewProviders();
    const index = providers.findIndex((provider) => provider.id === id);
    if (index < 0) throw new Error("Provider does not exist");
    providers[index] = {
      ...providers[index],
      modelSelectionControlledByCodex: providers[index].kind === "openai" ? true : controlledByCodex,
    };
    writePreviewProviders(providers);
    return providers[index];
  }
  return invoke<Provider>("set_provider_model_control", { id, controlledByCodex });
}

export async function setProviderGroup(id: string, group: string): Promise<Provider> {
  const normalizedGroup = group.trim();
  if (!hasLocalBackend) {
    const providers = readPreviewProviders();
    const index = providers.findIndex((provider) => provider.id === id);
    if (index < 0) throw new Error("Provider does not exist");
    if (providers[index].kind !== "custom") throw new Error("Only third-party Providers can be grouped");
    providers[index] = { ...providers[index], group: normalizedGroup };
    writePreviewProviders(providers);
    return providers[index];
  }
  return invoke<Provider>("set_provider_group", { id, group: normalizedGroup });
}

export async function setProviderAutoSwitchEnabled(id: string, enabled: boolean): Promise<void> {
  if (!hasLocalBackend) {
    const providers = readPreviewProviders();
    const selected = providers.find((provider) => provider.id === id);
    if (!selected) throw new Error("Provider does not exist");
    if (selected.kind !== "custom") {
      throw new Error("Automatic fallback is only available for third-party Providers");
    }
    writePreviewProviders(providers.map((provider) => ({
      ...provider,
      autoSwitchEnabled: provider.kind === "custom" && (
        enabled ? provider.id === id : provider.id !== id && provider.autoSwitchEnabled
      ),
    })));
    return;
  }
  await invoke("set_provider_auto_switch_enabled", { id, enabled });
}

export async function deactivateProvider(): Promise<void> {
  if (!hasLocalBackend) {
    writePreviewProviders(readPreviewProviders().map((provider) => ({ ...provider, active: false })));
    writePreviewAggregateApis(readPreviewAggregateApis().map((aggregate) => ({
      ...aggregate,
      active: false,
    })));
    return;
  }
  await invoke("disable_provider");
}

export interface CodexConfigRepairResult {
  repairedConfigCount: number;
  proxyConfigReapplied: boolean;
}

export async function repairCodexConfig(): Promise<CodexConfigRepairResult> {
  if (!hasLocalBackend) {
    throw new Error("Codex config repair is unavailable in browser preview");
  }
  return invoke<CodexConfigRepairResult>("repair_codex_config");
}

export async function removeProvider(id: string): Promise<void> {
  if (!hasLocalBackend) {
    writePreviewProviders(readPreviewProviders().filter((provider) => provider.id !== id));
    return;
  }
  await invoke("delete_provider", { id });
}

export async function loadLocalProxyStatus(): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) return previewLocalProxyStatus();
  return invoke<LocalProxyStatus>("get_local_proxy_status");
}

export async function setLocalProxyServiceTier(serviceTier: ProxyServiceTier): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    if (!previewLocalProxyStatus().running) {
      throw new Error("Start the local proxy before changing request speed");
    }
    window.localStorage.setItem(LOCAL_PROXY_SERVICE_TIER_PREVIEW_KEY, serviceTier);
    window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_local_proxy_service_tier", { serviceTier });
}

export async function loadProxySessions(): Promise<ProxySession[]> {
  if (!hasLocalBackend) {
    if (!previewLocalProxyStatus().running) return [];
    const now = Math.floor(Date.now() / 1000);
    return [
      {
        id: "019fa2da-d120-7e20-8e5a-079639b2d3ae",
        title: "Refine the provider switching flow",
        client: "codex_cli_rs/0.1.0",
        remoteAddress: "127.0.0.1:51742",
        connectedAt: now - 864,
        lastSeenAt: now - 3,
        activeRequests: 1,
        requestCount: 18,
        provider: "Official Codex",
        concurrentRouted: true,
        accountId: DEMO_ACCOUNTS[0]?.id ?? null,
        accountEmail: "alex.chen@example.com",
        model: "gpt-5.6-sol",
        contextTokens: 85_848,
        modelContextWindow: 258_400,
        totalTokens: 428_610,
        inputTokens: 397_842,
        outputTokens: 30_768,
        reasoningTokens: 21_442,
        cachedTokens: 312_960,
      },
      {
        id: "window-7c03b91e",
        title: "Investigate desktop startup",
        client: "Codex Desktop",
        remoteAddress: "127.0.0.1:51809",
        connectedAt: now - 292,
        lastSeenAt: now - 27,
        activeRequests: 0,
        requestCount: 7,
        provider: "AICoding.sh",
        model: "gpt-5.6-terra",
        contextTokens: 19_580,
        modelContextWindow: 121_600,
        totalTokens: 96_420,
        inputTokens: 88_105,
        outputTokens: 8_315,
        reasoningTokens: 4_126,
        cachedTokens: 67_504,
      },
    ];
  }
  return invoke<ProxySession[]>("list_proxy_sessions");
}

export async function loadProxyConversationAttachment(id: string): Promise<string | null> {
  if (!hasLocalBackend) return null;
  return invoke<string | null>("get_proxy_conversation_attachment", { id });
}

export async function loadProxySessionRequests(sessionId: string): Promise<ProxySessionRequest[]> {
  if (!hasLocalBackend) {
    const now = Math.floor(Date.now() / 1000);
    const preview: Record<string, ProxySessionRequest[]> = {
      "019fa2da-d120-7e20-8e5a-079639b2d3ae": [
        {
          id: 18,
          startedAt: now - 3,
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          conversation: '[\n  {\n    "role": "user",\n    "content": "Review the latest changes"\n  }\n]',
          firstResponseTimeMs: 1_460,
          responseTimeMs: null,
          totalTokens: null,
          inputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          cachedTokens: null,
        },
        {
          id: 17,
          startedAt: now - 92,
          model: "gpt-5.6-sol",
          reasoningEffort: "xhigh",
          conversation: '[\n  {\n    "role": "user",\n    "content": "Summarize this conversation"\n  }\n]',
          firstResponseTimeMs: 2_310,
          responseTimeMs: 16_720,
          totalTokens: 85_848,
          inputTokens: 72_088,
          outputTokens: 13_760,
          reasoningTokens: 13_440,
          cachedTokens: 69_456,
        },
      ],
      "window-7c03b91e": [
        {
          id: 7,
          startedAt: now - 27,
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
          conversation: '[\n  {\n    "role": "user",\n    "content": "Check the provider status"\n  }\n]',
          firstResponseTimeMs: 840,
          responseTimeMs: 3_280,
          totalTokens: 19_580,
          inputTokens: 17_204,
          outputTokens: 2_376,
          reasoningTokens: 1_152,
          cachedTokens: 12_880,
        },
      ],
    };
    return preview[sessionId] || [];
  }
  return invoke<ProxySessionRequest[]>("list_proxy_session_requests", { sessionId });
}

const PROXY_SESSION_UNLIMITED_CONVERSATION_PREVIEW_KEY =
  "codex-switch.proxy-session-unlimited-conversation";

export async function loadProxySessionUnlimitedConversation(): Promise<boolean> {
  if (hasLocalBackend) return invoke<boolean>("get_proxy_session_unlimited_conversation");
  return window.localStorage.getItem(PROXY_SESSION_UNLIMITED_CONVERSATION_PREVIEW_KEY) === "true";
}

export async function setProxySessionUnlimitedConversation(enabled: boolean): Promise<boolean> {
  if (hasLocalBackend) {
    return invoke<boolean>("set_proxy_session_unlimited_conversation", { enabled });
  }
  window.localStorage.setItem(
    PROXY_SESSION_UNLIMITED_CONVERSATION_PREVIEW_KEY,
    String(enabled),
  );
  return enabled;
}

export async function loadRecentProxySessionLatency(): Promise<ProxySessionLatencySummary> {
  if (!hasLocalBackend) {
    const sessions = (await loadProxySessions())
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .slice(0, 5);
    const requests = await Promise.all(sessions.map((session) => loadProxySessionRequests(session.id)));
    return requests.flat().reduce<ProxySessionLatencySummary>((summary, request) => {
      if (request.firstResponseTimeMs == null) return summary;
      summary.totalFirstResponseTimeMs += request.firstResponseTimeMs;
      summary.requestCount += 1;
      return summary;
    }, { totalFirstResponseTimeMs: 0, requestCount: 0 });
  }
  return invoke<ProxySessionLatencySummary>("get_recent_proxy_session_latency");
}

export async function loadTokenUsageEntries(startTs?: number): Promise<TokenUsageEntry[]> {
  if (!hasLocalBackend) {
    const now = Math.floor(Date.now() / 1000);
    const entries = [
      {
        id: "preview-token-1",
        ts: now - 92,
        provider: "Official Codex",
        accountId: "workspace-personal",
        accountEmail: "alex.chen@example.com",
        model: "gpt-5-codex",
        durationMs: 16720,
        inputTokens: 72_088,
        outputTokens: 13_760,
        reasoningTokens: 13_440,
        cachedTokens: 69_456,
        totalTokens: 85_848,
        modelContextWindow: 258_400,
      },
      {
        id: "preview-token-2",
        ts: now - 109,
        provider: "AICoding.sh",
        model: "gpt-5-codex",
        durationMs: 3280,
        inputTokens: 19548,
        outputTokens: 32,
        reasoningTokens: 0,
        cachedTokens: 19012,
        totalTokens: 19580,
        modelContextWindow: 121_600,
      },
    ];
    return startTs == null ? entries : entries.filter((entry) => entry.ts >= startTs);
  }
  if (startTs != null) {
    return invoke<TokenUsageEntry[]>("list_token_usage_entries_since", { startTs });
  }
  return invoke<TokenUsageEntry[]>("list_token_usage_entries");
}

export async function loadAccountTokenUsage(
  startTs: number,
  providers: Provider[] = [],
): Promise<AccountTokenUsageTotals[]> {
  const entries = await loadTokenUsageEntries(startTs);
  // Use one snapshot for counts and cost, including older rows with missing account metadata.
  const totals = new Map<string, AccountTokenUsageTotals>();
  for (const entry of entries) {
    if (entry.ts < startTs || (!entry.accountId && !entry.accountEmail)) continue;
    const key = JSON.stringify([
      entry.accountId?.trim() || null,
      entry.accountEmail?.trim().toLowerCase() || null,
    ]);
    const current = totals.get(key) ?? {
      accountId: entry.accountId,
      accountEmail: entry.accountEmail,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      estimatedCost: 0,
    };
    current.totalTokens += entry.totalTokens ?? (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
    current.inputTokens += entry.inputTokens ?? 0;
    current.outputTokens += entry.outputTokens ?? 0;
    current.reasoningTokens += entry.reasoningTokens ?? 0;
    current.cachedTokens += entry.cachedTokens ?? 0;
    current.estimatedCost += estimateTokenCost(entry, providers);
    totals.set(key, current);
  }
  return [...totals.values()];
}

export async function loadProviderTokenUsage(
  startTs: number,
  providers: Provider[] = [],
): Promise<ProviderTokenUsageTotals[]> {
  const entries = await loadTokenUsageEntries(0);
  const costByProvider = new Map<string, { today: number; total: number }>();
  entries.forEach((entry) => {
    const key = entry.providerId ? `id:${entry.providerId}` : `name:${entry.provider.trim()}`;
    const current = costByProvider.get(key) ?? { today: 0, total: 0 };
    const cost = estimateTokenCost(entry, providers);
    current.total += cost;
    if (entry.ts >= startTs) current.today += cost;
    costByProvider.set(key, current);
  });
  if (!hasLocalBackend) {
    const totals = new Map<string, ProviderTokenUsageTotals>();
    for (const entry of entries) {
      const provider = entry.provider.trim();
      if (!provider) continue;
      const current = totals.get(provider) ?? {
        provider,
        providerId: entry.providerId,
        todayTokens: 0,
        totalTokens: 0,
        todayEstimatedCost: 0,
        totalEstimatedCost: 0,
      };
      const tokens = entry.totalTokens ?? (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
      current.totalTokens += tokens;
      if (entry.ts >= startTs) current.todayTokens += tokens;
      const cost = estimateTokenCost(entry, providers);
      current.totalEstimatedCost += cost;
      if (entry.ts >= startTs) current.todayEstimatedCost += cost;
      totals.set(provider, current);
    }
    return [...totals.values()];
  }
  const totals = await invoke<ProviderTokenUsageTotals[]>("list_provider_token_usage", { startTs });
  return totals.map((total) => {
    const costs = costByProvider.get(total.providerId
      ? `id:${total.providerId}`
      : `name:${total.provider.trim()}`) ?? { today: 0, total: 0 };
    return { ...total, todayEstimatedCost: costs.today, totalEstimatedCost: costs.total };
  });
}

export async function loadDailyTokenUsage(startTs: number): Promise<DailyTokenUsage[]> {
  if (!hasLocalBackend) {
    const entries: DailyTokenUsage[] = [];
    const date = new Date(startTs * 1000);
    date.setHours(12, 0, 0, 0);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    while (date <= today) {
      const signal = date.getDate() + date.getMonth() * 7 + date.getDay() * 3;
      if (signal % 4 !== 0) {
        entries.push({
          date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
          totalTokens: (signal % 7 + 1) * 18_400,
          inputTokens: (signal % 7 + 1) * 14_200,
          outputTokens: (signal % 7 + 1) * 4_200,
          reasoningTokens: (signal % 4 + 1) * 1_150,
          cachedTokens: (signal % 5 + 1) * 8_100,
        });
      }
      date.setDate(date.getDate() + 1);
    }
    return entries;
  }
  return invoke<DailyTokenUsage[]>("list_daily_token_usage", { startTs });
}

export async function loadTokenUsageBreakdown(
  startTs: number,
  longContextThresholdTokens: number,
): Promise<DailyTokenUsageBreakdown[]> {
  if (!hasLocalBackend) return previewTokenBreakdown(await loadDailyTokenUsage(startTs));
  return invoke<DailyTokenUsageBreakdown[]>("list_token_usage_breakdown", {
    startTs, longContextThresholdTokens,
  });
}

export async function loadAccountQuotaHistory(startTs: number, endTs: number): Promise<AccountQuotaHistory[]> {
  if (!hasLocalBackend) return previewAccountQuotaHistory(startTs, endTs);
  return invoke<AccountQuotaHistory[]>("list_account_quota_history", { startTs, endTs });
}

export async function showTokenUsageWindow(): Promise<void> {
  if (!isDesktopApp) {
    window.open(`${window.location.pathname}?cache=${Date.now()}#token-usage`, "_blank", "noopener,noreferrer");
    return;
  }
  await invoke("show_token_usage_window");
}

export async function loadAccounts(): Promise<Account[]> {
  if (!hasLocalBackend) return structuredClone(DEMO_ACCOUNTS);
  return invoke<Account[]>("list_accounts");
}

const AUTO_RESET_PREVIEW_KEY = "codex-switch-auto-reset";

export async function loadAutoResetSettings(): Promise<AutoResetSettings> {
  if (hasLocalBackend) return invoke<AutoResetSettings>("get_auto_reset_settings");
  const saved = window.localStorage.getItem(AUTO_RESET_PREVIEW_KEY);
  return saved ? JSON.parse(saved) as AutoResetSettings
    : { enabled: false, accountIds: null, maxCards: 1, reserveCards: 0 };
}

export async function saveAutoResetSettings(settings: AutoResetSettings): Promise<void> {
  if (hasLocalBackend) return invoke("set_auto_reset_settings", { settings });
  window.localStorage.setItem(AUTO_RESET_PREVIEW_KEY, JSON.stringify(settings));
}

export async function startLocalProxy(): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    if (!previewLocalProxyStatus().port) {
      throw new Error("Configure the web proxy listening port in Settings before starting the proxy");
    }
    window.localStorage.setItem(LOCAL_PROXY_PREVIEW_KEY, "true");
    writePreviewProviders(readPreviewProviders().map((provider) => ({
      ...provider,
      supportsDirectSwitch: true,
    })));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("start_local_proxy");
}

export async function updateWebProxyPort(port: number | null): Promise<AppSettings> {
  if (hasLocalBackend) return invoke<AppSettings>("set_web_proxy_port", { port });
  if (port === null) {
    window.localStorage.removeItem(LOCAL_PROXY_PORT_PREVIEW_KEY);
    window.localStorage.removeItem(LOCAL_PROXY_PREVIEW_KEY);
  } else {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("Web proxy listening port must be between 1 and 65535");
    }
    window.localStorage.setItem(LOCAL_PROXY_PORT_PREVIEW_KEY, String(port));
  }
  window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
  return loadAppSettings();
}

export async function updateWebProxyListenOnAllInterfaces(enabled: boolean): Promise<AppSettings> {
  if (hasLocalBackend) {
    return invoke<AppSettings>("set_web_proxy_listen_on_all_interfaces", { enabled });
  }
  window.localStorage.setItem(WEB_PROXY_LISTEN_ALL_INTERFACES_PREVIEW_KEY, String(enabled));
  return loadAppSettings();
}

export async function stopLocalProxy(): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    window.localStorage.removeItem(LOCAL_PROXY_PREVIEW_KEY);
    writePreviewProviders(readPreviewProviders().map((provider) => ({
      ...provider,
      active: false,
      supportsDirectSwitch: false,
    })));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("stop_local_proxy");
}

export async function stopLocalProxyWithoutMigrating(): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) return stopLocalProxy();
  return invoke<LocalProxyStatus>("stop_local_proxy_without_migrating");
}

export async function restoreNonProxyConversations(): Promise<DirectConversationSyncResult> {
  if (!hasLocalBackend) return { conversationsUpdated: 0, rolloutFilesUpdated: 0 };
  return invoke<DirectConversationSyncResult>("restore_non_proxy_conversations");
}

export async function loadCodexThreads(filters: {
  titleQuery?: string;
  contentQuery?: string;
} = {}, homeId?: string): Promise<CodexThreadEntry[]> {
  if (!hasLocalBackend) return [];
  return invoke<CodexThreadEntry[]>("browse_codex_threads", { homeId,
    titleQuery: filters.titleQuery?.trim() || null,
    contentQuery: filters.contentQuery?.trim() || null,
  });
}

export async function loadCodexThreadTokens(sessionIds: string[], homeId?: string): Promise<CodexThreadTokenTotals[]> {
  if (!hasLocalBackend) return [];
  return invoke<CodexThreadTokenTotals[]>("measure_codex_thread_tokens", { homeId, sessionIds });
}

export async function moveCodexThreadsToBin(sessionIds: string[], homeId?: string): Promise<CodexThreadMutationReport> {
  return invoke<CodexThreadMutationReport>("discard_codex_threads", { homeId, sessionIds });
}

export async function loadCodexThreadBin(homeId?: string): Promise<CodexThreadBinEntry[]> {
  if (!hasLocalBackend) return [];
  return invoke<CodexThreadBinEntry[]>("browse_codex_thread_bin", { homeId });
}

export async function restoreCodexThreads(
  sessionIds: string[], homeId?: string, targetHomeId?: string,
): Promise<CodexThreadMutationReport> {
  return invoke<CodexThreadMutationReport>("recover_codex_threads", { homeId, sessionIds, targetHomeId });
}

export async function deleteCodexThreadsForever(
  sessionIds: string[], homeId?: string,
): Promise<CodexThreadMutationReport> {
  return invoke<CodexThreadMutationReport>("purge_codex_threads", { homeId, sessionIds });
}

export async function clearCodexThreadBin(homeId?: string): Promise<CodexThreadMutationReport> {
  return invoke<CodexThreadMutationReport>("empty_codex_thread_bin", { homeId });
}

export async function previewCodexThreadExport(
  sessionIds: string[], homeId?: string,
): Promise<CodexThreadBundlePreview> {
  return invoke<CodexThreadBundlePreview>("inspect_codex_thread_export", { homeId, sessionIds });
}

export async function saveCodexThreadPackage(
  sessionIds: string[], homeId?: string,
): Promise<CodexThreadBundleResult | null> {
  const exportPath = await save({
    title: "导出 Codex 会话",
    defaultPath: `codex-sessions-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: "Codex session package", extensions: ["zip"] }],
  });
  if (!exportPath) return null;
  return invoke<CodexThreadBundleResult>("pack_codex_threads", { homeId, sessionIds, exportPath });
}

export async function chooseCodexThreadPackage(): Promise<string | null> {
  const selected = await open({
    title: "导入 Codex 会话",
    multiple: false,
    directory: false,
    filters: [{ name: "Codex session package", extensions: ["zip"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function previewCodexThreadImport(importPath: string, homeId?: string): Promise<CodexThreadBundlePreview> {
  return invoke<CodexThreadBundlePreview>("inspect_codex_thread_import", { homeId, importPath });
}

export async function importCodexThreads(
  importPath: string, sessionIds: string[], homeId?: string,
): Promise<CodexThreadBundleResult> {
  return invoke<CodexThreadBundleResult>("unpack_codex_threads", { homeId, importPath, sessionIds });
}

export async function copyWebProxyLanApiKey(): Promise<void> {
  if (isHostedWebApp) {
    const secret = await invoke<string>("copy_web_proxy_lan_api_key");
    return copyText(secret);
  }
  return invoke<void>("copy_web_proxy_lan_api_key");
}

export function migrateCodexThreadsToHome(request: {
  homeId: string;
  targetHomeId: string;
  sessionIds: string[];
}): Promise<CodexThreadMigrationReport> {
  return invoke<CodexThreadMigrationReport>("migrate_codex_threads_to_home", { request });
}

export async function migrateCodexThreads(sessionIds: string[], homeId?: string): Promise<CodexThreadMigrationReport> {
  if (!hasLocalBackend) throw new Error("会话迁移需要桌面版 Remote AI");
  return invoke<CodexThreadMigrationReport>("migrate_codex_threads", { homeId, sessionIds });
}

export async function repairCodexThreadVisibility(options: {
  mode: "quick" | "deep";
  sessionIds?: string[] | null;
  dryRun?: boolean;
}, homeId?: string): Promise<CodexThreadVisibilityReport> {
  return invoke<CodexThreadVisibilityReport>("reconcile_codex_thread_visibility", {
    request: { homeId, mode: options.mode, sessionIds: options.sessionIds ?? null, dryRun: options.dryRun ?? false },
  });
}

export async function syncCodexThreadIndex(homeId?: string): Promise<CodexThreadVisibilityReport> {
  return invoke<CodexThreadVisibilityReport>("rebuild_codex_thread_index", { homeId });
}

export async function openCodexThreadPath(sessionId: string, folderOnly: boolean, homeId?: string): Promise<void> {
  return invoke<void>("open_codex_thread_file", { homeId, sessionId, folderOnly });
}

export async function setLocalProxyAutoSwitch(enabled: boolean): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    if (enabled && !previewLocalProxyStatus().running) {
      throw new Error("Start the local proxy before enabling automatic account switching");
    }
    window.localStorage.setItem(LOCAL_PROXY_AUTO_SWITCH_PREVIEW_KEY, String(enabled));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_auto_switch_on_quota_exhaustion", { enabled });
}

export async function setLocalProxyAutoDisableUnreachable(enabled: boolean): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    const status = previewLocalProxyStatus();
    if (enabled && (!status.running || !status.autoSwitchOnQuotaExhaustion)) {
      throw new Error("Enable automatic account switching before enabling automatic disabling by HTTP status");
    }
    window.localStorage.setItem(LOCAL_PROXY_AUTO_DISABLE_UNREACHABLE_PREVIEW_KEY, String(enabled));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_auto_disable_unreachable_accounts", { enabled });
}

export async function setLocalProxyCustomPriority(enabled: boolean): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    const status = previewLocalProxyStatus();
    if (enabled && (!status.running || !status.autoSwitchOnQuotaExhaustion)) {
      throw new Error("Enable automatic account switching before enabling custom priorities");
    }
    window.localStorage.setItem(LOCAL_PROXY_CUSTOM_PRIORITY_PREVIEW_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_custom_auto_switch_priority_enabled", { enabled });
}

export async function setSystemPromptFilterEnabled(enabled: boolean): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(SYSTEM_PROMPT_FILTER_PREVIEW_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_system_prompt_filter_enabled", { enabled });
}

export async function setSystemPromptFilterRules(rules: SystemPromptRule[]): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(SYSTEM_PROMPT_FILTER_RULES_PREVIEW_KEY, JSON.stringify(rules));
    window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_system_prompt_filter_rules", { rules });
}

export async function setSystemPromptInjectionEnabled(enabled: boolean): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(SYSTEM_PROMPT_INJECTION_PREVIEW_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_system_prompt_injection_enabled", { enabled });
}

export async function setSystemPromptInjectionPrompts(prompts: SystemPromptRule[]): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(SYSTEM_PROMPT_INJECTION_PROMPTS_PREVIEW_KEY, JSON.stringify(prompts));
    window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_system_prompt_injection_prompts", { prompts });
}

export async function setLocalProxyCustomThreshold(enabled: boolean): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    const status = previewLocalProxyStatus();
    if (enabled && (!status.running || !status.autoSwitchOnQuotaExhaustion)) {
      throw new Error("Enable automatic account switching before enabling custom thresholds");
    }
    window.localStorage.setItem(LOCAL_PROXY_CUSTOM_THRESHOLD_PREVIEW_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_custom_auto_switch_threshold_enabled", { enabled });
}

export async function setLocalProxyGlobalThreshold(threshold: number): Promise<LocalProxyStatus> {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error("Global auto-switch threshold must be between 0 and 100");
  }
  if (!hasLocalBackend) {
    window.localStorage.setItem(LOCAL_PROXY_GLOBAL_THRESHOLD_PREVIEW_KEY, String(threshold));
    window.dispatchEvent(new CustomEvent(PROVIDERS_EVENT));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_global_auto_switch_threshold", { threshold });
}

export async function setLocalProxyImageAccount(accountId: string | null): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    if (!previewLocalProxyStatus().running) {
      throw new Error("Start the local proxy before selecting an image generation account");
    }
    if (accountId) window.localStorage.setItem(LOCAL_PROXY_IMAGE_ACCOUNT_PREVIEW_KEY, accountId);
    else window.localStorage.removeItem(LOCAL_PROXY_IMAGE_ACCOUNT_PREVIEW_KEY);
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_image_generation_account", { accountId });
}

export async function setLocalProxyImageModelTarget(
  routeKind: ImageRouteKind,
  target: ImageModelTarget | null,
): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    if (!previewLocalProxyStatus().running) {
      throw new Error("Start the local proxy before selecting an image model");
    }
    const key = routeKind === "input"
      ? LOCAL_PROXY_IMAGE_INPUT_TARGET_PREVIEW_KEY
      : LOCAL_PROXY_IMAGE_OUTPUT_TARGET_PREVIEW_KEY;
    if (target) window.localStorage.setItem(key, JSON.stringify(target));
    else window.localStorage.removeItem(key);
    if (routeKind === "output") {
      if (target?.kind === "official") {
        window.localStorage.setItem(LOCAL_PROXY_IMAGE_ACCOUNT_PREVIEW_KEY, target.accountId);
      } else {
        window.localStorage.removeItem(LOCAL_PROXY_IMAGE_ACCOUNT_PREVIEW_KEY);
      }
    }
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_image_model_target", { routeKind, target });
}

export async function setLocalProxyOpenaiAuthAccount(accountId: string | null): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    if (!previewLocalProxyStatus().running) {
      throw new Error("Start the local proxy before selecting an OpenAI login account");
    }
    if (accountId) window.localStorage.setItem(LOCAL_PROXY_OPENAI_AUTH_ACCOUNT_PREVIEW_KEY, accountId);
    else window.localStorage.removeItem(LOCAL_PROXY_OPENAI_AUTH_ACCOUNT_PREVIEW_KEY);
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_local_proxy_openai_auth_account", { accountId });
}

export async function updateNetworkProxy(settings: NetworkProxySettings): Promise<AppSettings> {
  if (hasLocalBackend) return invoke<AppSettings>("set_network_proxy", { settings });
  window.localStorage.setItem(NETWORK_PROXY_ENABLED_PREVIEW_KEY, String(settings.enabled));
  window.localStorage.setItem(NETWORK_PROXY_URL_PREVIEW_KEY, settings.proxyUrl.trim());
  if (settings.proxyPort === null) window.localStorage.removeItem(NETWORK_PROXY_PORT_PREVIEW_KEY);
  else window.localStorage.setItem(NETWORK_PROXY_PORT_PREVIEW_KEY, String(settings.proxyPort));
  return loadAppSettings();
}

export async function updateLaunchAtStartup(enabled: boolean): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(LAUNCH_AT_STARTUP_PREVIEW_KEY, String(enabled));
    return loadAppSettings();
  }
  return invoke<AppSettings>("set_launch_at_startup", { enabled });
}

export async function updateCloseToTray(enabled: boolean): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(CLOSE_TO_TRAY_PREVIEW_KEY, String(enabled));
    return loadAppSettings();
  }
  return invoke<AppSettings>("set_close_to_tray", { enabled });
}

export async function updateNonProxyEnhancements(enabled: boolean): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(NON_PROXY_ENHANCEMENTS_PREVIEW_KEY, String(enabled));
    return loadAppSettings();
  }
  return invoke<AppSettings>("set_non_proxy_enhancements", { enabled });
}

export async function updateFloatingBubble(enabled: boolean): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(FLOATING_BUBBLE_PREVIEW_KEY, String(enabled));
    return {
      floatingBubbleEnabled: enabled,
      privacyMode: window.localStorage.getItem(PRIVACY_MODE_PREVIEW_KEY) !== "false",
      hideAccountNotes: window.localStorage.getItem(HIDE_ACCOUNT_NOTES_PREVIEW_KEY) === "true",
      bubbleResetDisplay: window.localStorage.getItem(BUBBLE_RESET_DISPLAY_PREVIEW_KEY) === "resetAt" ? "resetAt" : "countdown",
      bubbleStyle: previewBubbleStyle(),
      themeColor: normalizeThemeColor(window.localStorage.getItem(THEME_COLOR_PREVIEW_KEY) ?? DEFAULT_THEME_COLOR),
    };
  }
  return invoke<AppSettings>("set_floating_bubble", { enabled });
}

export async function updatePrivacyMode(enabled: boolean): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(PRIVACY_MODE_PREVIEW_KEY, String(enabled));
    return {
      floatingBubbleEnabled: previewFloatingBubbleEnabled(),
      privacyMode: enabled,
      hideAccountNotes: window.localStorage.getItem(HIDE_ACCOUNT_NOTES_PREVIEW_KEY) === "true",
      bubbleResetDisplay: window.localStorage.getItem(BUBBLE_RESET_DISPLAY_PREVIEW_KEY) === "resetAt" ? "resetAt" : "countdown",
      bubbleStyle: previewBubbleStyle(),
      themeColor: normalizeThemeColor(window.localStorage.getItem(THEME_COLOR_PREVIEW_KEY) ?? DEFAULT_THEME_COLOR),
    };
  }
  return invoke<AppSettings>("set_privacy_mode", { enabled });
}

export async function updateHideAccountNotes(enabled: boolean): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(HIDE_ACCOUNT_NOTES_PREVIEW_KEY, String(enabled));
    return loadAppSettings();
  }
  return invoke<AppSettings>("set_hide_account_notes", { enabled });
}

export async function updateTokenUsagePreferences(
  weeks: number,
  refreshSeconds: number,
  codexSummaryEnabled: boolean,
): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(TOKEN_USAGE_WEEKS_PREVIEW_KEY, String(weeks));
    window.localStorage.setItem(TOKEN_USAGE_REFRESH_PREVIEW_KEY, String(refreshSeconds));
    window.localStorage.setItem(CODEX_USAGE_SUMMARY_PREVIEW_KEY, String(codexSummaryEnabled));
    return loadAppSettings();
  }
  return invoke<AppSettings>("set_token_usage_preferences", {
    weeks,
    refreshSeconds,
    codexSummaryEnabled,
  });
}

export async function setLocalProxyConcurrentRouting(
  enabled: boolean,
  accountGroup: string | null = null,
): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    if (enabled && !previewLocalProxyStatus().running) {
      throw new Error("Start the local proxy before enabling concurrent account routing");
    }
    window.localStorage.setItem(LOCAL_PROXY_CONCURRENT_ROUTING_PREVIEW_KEY, String(enabled));
    if (accountGroup) window.localStorage.setItem(LOCAL_PROXY_CONCURRENT_GROUP_PREVIEW_KEY, accountGroup);
    else window.localStorage.removeItem(LOCAL_PROXY_CONCURRENT_GROUP_PREVIEW_KEY);
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_concurrent_account_routing_enabled", { enabled, accountGroup });
}

export async function updateAutoDisableStatusCodes(statusCodes: number[]): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(AUTO_DISABLE_STATUS_CODES_PREVIEW_KEY, JSON.stringify(statusCodes));
    return loadAppSettings();
  }
  return invoke<AppSettings>("set_auto_disable_status_codes", { statusCodes });
}

export async function updateUpstream429RetryTimeout(timeoutSeconds: number): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(UPSTREAM_429_RETRY_TIMEOUT_PREVIEW_KEY, String(timeoutSeconds));
    return loadAppSettings();
  }
  return invoke<AppSettings>("set_upstream_429_retry_timeout", { timeoutSeconds });
}

export async function updateShowUsageNetworkErrors(enabled: boolean): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(SHOW_USAGE_NETWORK_ERRORS_PREVIEW_KEY, String(enabled));
    return loadAppSettings();
  }
  return invoke<AppSettings>("set_show_usage_network_errors", { enabled });
}

export async function updateBubbleResetDisplay(display: BubbleResetDisplay): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(BUBBLE_RESET_DISPLAY_PREVIEW_KEY, display);
    window.dispatchEvent(new CustomEvent<BubbleResetDisplay>(BUBBLE_RESET_DISPLAY_EVENT, { detail: display }));
    return {
      floatingBubbleEnabled: previewFloatingBubbleEnabled(),
      privacyMode: window.localStorage.getItem(PRIVACY_MODE_PREVIEW_KEY) !== "false",
      hideAccountNotes: window.localStorage.getItem(HIDE_ACCOUNT_NOTES_PREVIEW_KEY) === "true",
      bubbleResetDisplay: display,
      bubbleStyle: previewBubbleStyle(),
      themeColor: normalizeThemeColor(window.localStorage.getItem(THEME_COLOR_PREVIEW_KEY) ?? DEFAULT_THEME_COLOR),
    };
  }
  return invoke<AppSettings>("set_bubble_reset_display", { display });
}

export async function updateBubbleStyle(style: BubbleStyle): Promise<AppSettings> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(BUBBLE_STYLE_PREVIEW_KEY, style);
    window.dispatchEvent(new CustomEvent<BubbleStyle>(BUBBLE_STYLE_EVENT, { detail: style }));
    return loadAppSettings();
  }
  return invoke<AppSettings>("set_bubble_style", { style });
}

export async function updateThemeColor(color: string): Promise<AppSettings> {
  const themeColor = normalizeThemeColor(color);
  if (!hasLocalBackend) {
    window.localStorage.setItem(THEME_COLOR_PREVIEW_KEY, themeColor);
    window.dispatchEvent(new CustomEvent<string>(THEME_COLOR_EVENT, { detail: themeColor }));
    return {
      floatingBubbleEnabled: previewFloatingBubbleEnabled(),
      privacyMode: window.localStorage.getItem(PRIVACY_MODE_PREVIEW_KEY) !== "false",
      hideAccountNotes: window.localStorage.getItem(HIDE_ACCOUNT_NOTES_PREVIEW_KEY) === "true",
      bubbleResetDisplay: window.localStorage.getItem(BUBBLE_RESET_DISPLAY_PREVIEW_KEY) === "resetAt" ? "resetAt" : "countdown",
      bubbleStyle: previewBubbleStyle(),
      themeColor,
    };
  }
  return invoke<AppSettings>("set_theme_color", { color: themeColor });
}

export async function loadCloudAuthState(): Promise<CloudAuthState> {
  if (!hasLocalBackend) return previewCloudState();
  return invoke<CloudAuthState>("get_cloud_auth_state");
}

export async function loadSavedCloudLogin(): Promise<SavedCloudLogin | null> {
  // Saved passwords belong to the desktop credential store, not remote browsers.
  if (!isDesktopApp) return null;
  return invoke<SavedCloudLogin | null>("get_saved_cloud_login");
}

export async function updateCloudBaseUrl(baseUrl: string): Promise<CloudAuthState> {
  if (!hasLocalBackend) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    window.localStorage.setItem(CLOUD_BASE_URL_PREVIEW_KEY, normalized);
    if (!normalized) {
      window.localStorage.removeItem(CLOUD_USER_PREVIEW_KEY);
    }
    return previewCloudState();
  }
  return invoke<CloudAuthState>("set_cloud_base_url", { baseUrl });
}

export async function loginCloud(
  email: string,
  password: string,
  rememberPassword: boolean,
): Promise<CloudAuthenticationResult> {
  if (!hasLocalBackend) {
    if (!previewCloudState().baseUrl) throw new Error("Cloud server base URL is not configured");
    if (!email || !password) throw new Error("Email and password are required");
    window.localStorage.setItem(CLOUD_USER_PREVIEW_KEY, email);
    return {
      state: previewCloudState(),
      passwordSaved: false,
      credentialStorageUpdated: !rememberPassword,
    };
  }
  return invoke<CloudAuthenticationResult>("cloud_login", { email, password, rememberPassword });
}

export async function fetchCloudAnnouncement(): Promise<CloudAnnouncement> {
  if (hasLocalBackend) return invoke<CloudAnnouncement>("fetch_cloud_announcement");
  const { baseUrl } = previewCloudState();
  if (!baseUrl) return {
    content: "",
    contentZh: "",
    contentEn: "",
    link: "",
    enabled: false,
    textColor: "#C4D7C8",
    backgroundColor: "#203128",
    darkTextColor: "#C4D7C8",
    darkBackgroundColor: "#203128",
    scrollDurationSeconds: 22,
    updatedAt: null,
  };
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/announcements/current`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Announcement request failed with HTTP ${response.status}`);
  return response.json() as Promise<CloudAnnouncement>;
}

export async function reportAnnouncementClick(
  link: string,
  announcementUpdatedAt?: string | null,
): Promise<void> {
  if (!isDesktopApp) return;
  await invoke("report_announcement_click", { link, announcementUpdatedAt });
}

export async function submitFeedback(
  content: string,
  version: string,
  contactEmail: string | null,
  images: File[],
): Promise<void> {
  const platform = (navigator.userAgent || navigator.platform || "unknown").slice(0, 500);
  if (isDesktopApp) {
    const inputs: FeedbackImageInput[] = await Promise.all(images.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type,
      dataBase64: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
        reader.onerror = () => reject(reader.error ?? new Error("Unable to read feedback image"));
        reader.readAsDataURL(file);
      }),
    })));
    await invoke("submit_feedback", { content, version, platform, contactEmail, images: inputs });
    return;
  }

  const { baseUrl } = previewCloudState();
  if (!baseUrl) throw new Error("Cloud server base URL is not configured");
  const form = new FormData();
  form.append("content", content);
  form.append("version", version);
  form.append("platform", platform);
  if (contactEmail) form.append("email", contactEmail);
  images.forEach((image) => form.append("images", image, image.name));
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/feedback`, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message || `Feedback submission failed with HTTP ${response.status}`);
  }
}

export async function reportFirstInstallation(): Promise<boolean> {
  if (!isDesktopApp) return false;
  return invoke<boolean>("report_first_installation");
}

export async function reportDeviceActivity(): Promise<void> {
  if (!isDesktopApp) return;
  return invoke<void>("report_device_activity");
}

export async function reportBaseUrlChange(): Promise<void> {
  if (!isDesktopApp) return;
  return invoke<void>("report_base_url_change");
}

export async function requestCloudRegistrationCode(email: string): Promise<void> {
  if (!hasLocalBackend) {
    if (!previewCloudState().baseUrl) throw new Error("Cloud server base URL is not configured");
    if (!email) throw new Error("Email is required");
    return;
  }
  await invoke("cloud_request_registration_code", { email });
}

export async function registerCloud(
  email: string,
  password: string,
  verificationCode: string,
  rememberPassword: boolean,
): Promise<CloudAuthenticationResult> {
  if (!hasLocalBackend) return loginCloud(email, password, rememberPassword);
  return invoke<CloudAuthenticationResult>("cloud_register", {
    email,
    password,
    verificationCode,
    rememberPassword,
  });
}

export async function fetchCloudNotifications(): Promise<CloudNotification[]> {
  if (hasLocalBackend) return invoke<CloudNotification[]>("fetch_cloud_notifications");
  const { baseUrl } = previewCloudState();
  if (!baseUrl) return [];
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/notifications/recent`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Notification request failed with HTTP ${response.status}`);
  return response.json() as Promise<CloudNotification[]>;
}

export async function fetchCloudFaqs(): Promise<CloudFaq[]> {
  if (hasLocalBackend) return invoke<CloudFaq[]>("fetch_cloud_faqs");
  const { baseUrl } = previewCloudState();
  if (!baseUrl) return [];
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/faqs`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`FAQ request failed with HTTP ${response.status}`);
  return response.json() as Promise<CloudFaq[]>;
}

const SKILL_MARKET_INSTALLED_PREVIEW_KEY = "codex-switch:skill-market-installed";

interface PreviewInstalledSkill {
  enabled: boolean;
  version: string;
}

function previewInstalledSkills(): Record<string, PreviewInstalledSkill> {
  try {
    const value = JSON.parse(window.localStorage.getItem(SKILL_MARKET_INSTALLED_PREVIEW_KEY) ?? "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([id, installed]) => {
      if (typeof installed === "string") return [[id, { enabled: true, version: installed }]];
      if (!installed || typeof installed !== "object" || Array.isArray(installed)) return [];
      const candidate = installed as Partial<PreviewInstalledSkill>;
      return typeof candidate.version === "string"
        ? [[id, { enabled: candidate.enabled !== false, version: candidate.version }]]
        : [];
    }));
  } catch {
    return {};
  }
}

function savePreviewInstalledSkills(installed: Record<string, PreviewInstalledSkill>) {
  window.localStorage.setItem(SKILL_MARKET_INSTALLED_PREVIEW_KEY, JSON.stringify(installed));
}

export async function fetchSkillMarket(homeId?: string): Promise<SkillMarketItem[]> {
  if (hasLocalBackend) return invoke<SkillMarketItem[]>("list_market_skills", { homeId });
  const { baseUrl } = previewCloudState();
  if (!baseUrl) return [];
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/skills`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Skill market request failed with HTTP ${response.status}`);
  const payload = await response.json() as { items: SkillMarketItem[] };
  const installed = previewInstalledSkills();
  return payload.items.map((item) => ({
    ...item,
    installedVersion: installed[item.id]?.version ?? null,
    installed: installed[item.id]?.version === item.version,
    enabled: installed[item.id]?.enabled ?? false,
  }));
}

function selectedPackage(path: string, kind: SkillPackageSelection["kind"]): SkillPackageSelection {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const name = parts[parts.length - 1] ?? (kind === "folder" ? "skill-folder" : "skill.zip");
  return { path, kind, name };
}

export async function chooseSkillArchive(): Promise<SkillPackageSelection | null> {
  if (!isDesktopApp) return null;
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Skill ZIP archive", extensions: ["zip"] }],
  });
  return typeof path === "string" ? selectedPackage(path, "archive") : null;
}

export async function chooseSkillFolder(): Promise<SkillPackageSelection | null> {
  if (!isDesktopApp) return null;
  const path = await open({ multiple: false, directory: true });
  return typeof path === "string" ? selectedPackage(path, "folder") : null;
}

export async function publishSkill(input: SkillPublishInput): Promise<SkillMarketItem> {
  if (!isDesktopApp) throw new Error("Skill publishing is available in the desktop app");
  return invoke<SkillMarketItem>("upload_market_skill", {
    request: {
      title: input.title,
      description: input.description,
      version: input.version,
      skillId: input.skillId ?? null,
      packagePath: input.package.path,
      packageKind: input.package.kind,
      preview: input.preview ?? null,
    },
  });
}

export async function installMarketSkill(skill: SkillMarketItem, homeId?: string): Promise<void> {
  if (!hasLocalBackend) {
    const installed = previewInstalledSkills();
    installed[skill.id] = { enabled: installed[skill.id]?.enabled ?? true, version: skill.version };
    savePreviewInstalledSkills(installed);
    return;
  }
  await invoke("install_market_skill", { skill, homeId });
}

export async function removeMarketSkill(skillId: string, homeId?: string): Promise<void> {
  if (!hasLocalBackend) {
    const installed = previewInstalledSkills();
    delete installed[skillId];
    savePreviewInstalledSkills(installed);
    return;
  }
  await invoke("remove_market_skill", { skillId, homeId });
}

export async function setMarketSkillEnabled(skillId: string, enabled: boolean, homeId?: string): Promise<void> {
  if (!hasLocalBackend) {
    const installed = previewInstalledSkills();
    const current = installed[skillId];
    if (!current) throw new Error("Install this plugin before changing its status");
    installed[skillId] = { ...current, enabled };
    savePreviewInstalledSkills(installed);
    return;
  }
  await invoke("set_market_skill_enabled", { skillId, enabled, homeId });
}

export async function fetchOfficialPlugins(homeId: string): Promise<OfficialPluginItem[]> {
  if (!hasLocalBackend) return [];
  return invoke<OfficialPluginItem[]>("list_official_plugins", { homeId });
}

const PROMPT_PLUGIN_PREVIEW_KEY = "codex-switch:prompt-plugin-installed";

function previewPromptPlugins(): Record<string, { version: string; enabled: boolean }> {
  try {
    const value = JSON.parse(window.localStorage.getItem(PROMPT_PLUGIN_PREVIEW_KEY) ?? "{}") as Record<string, { version: string; enabled?: boolean }>;
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item && typeof item.version === "string")
      .map(([id, item]) => [id, { version: item.version, enabled: item.enabled !== false }]));
  } catch { return {}; }
}

export async function fetchPromptPlugins(): Promise<PromptPluginItem[]> {
  if (hasLocalBackend) return invoke<PromptPluginItem[]>("list_prompt_plugins");
  const { baseUrl } = previewCloudState();
  if (!baseUrl) return [];
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/prompt-plugins`, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Prompt plugin market request failed with HTTP ${response.status}`);
  const payload = await response.json() as { items: PromptPluginItem[] };
  const installed = previewPromptPlugins();
  return payload.items.map((item) => {
    const stored = installed[item.id];
    const installedVersion = stored?.version === "latest" ? item.version : (stored?.version ?? null);
    return { ...item, installedVersion, installed: installedVersion === item.version, enabled: stored?.enabled ?? false };
  });
}

export async function publishPromptPlugin(input: PromptPluginPublishInput): Promise<PromptPluginItem> {
  if (hasLocalBackend) return invoke<PromptPluginItem>("publish_prompt_plugin", { pluginId: input.pluginId ?? null, name: input.name, version: input.version, type: input.type, text: input.text });
  const { baseUrl, authenticated } = previewCloudState();
  if (!baseUrl || !authenticated) throw new Error("Please sign in before publishing a prompt plugin");
  const pluginPath = input.pluginId ? `/prompt-plugins/${encodeURIComponent(input.pluginId)}` : "/prompt-plugins";
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${pluginPath}`, { method: input.pluginId ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ name: input.name, version: input.version, type: input.type, text: input.text }) });
  if (!response.ok) throw new Error(`Prompt plugin publish failed with HTTP ${response.status}`);
  return response.json() as Promise<PromptPluginItem>;
}

export async function installPromptPlugin(pluginId: string, version?: string): Promise<void> {
  if (hasLocalBackend) return invoke("install_prompt_plugin", { pluginId });
  const installed = previewPromptPlugins();
  installed[pluginId] = { version: version ?? "latest", enabled: installed[pluginId]?.enabled ?? true };
  window.localStorage.setItem(PROMPT_PLUGIN_PREVIEW_KEY, JSON.stringify(installed));
}

export async function removePromptPlugin(pluginId: string): Promise<void> {
  if (hasLocalBackend) return invoke("remove_prompt_plugin", { pluginId });
  const installed = previewPromptPlugins(); delete installed[pluginId];
  window.localStorage.setItem(PROMPT_PLUGIN_PREVIEW_KEY, JSON.stringify(installed));
}

export async function setPromptPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  if (hasLocalBackend) return invoke("set_prompt_plugin_enabled", { pluginId, enabled });
  const installed = previewPromptPlugins();
  if (!installed[pluginId]) throw new Error("Install this prompt plugin before changing its status");
  installed[pluginId].enabled = enabled;
  window.localStorage.setItem(PROMPT_PLUGIN_PREVIEW_KEY, JSON.stringify(installed));
}

export async function installOfficialPlugin(pluginId: string, homeId: string): Promise<void> {
  if (!hasLocalBackend) {
    throw new Error("Official plugins are available when Remote AI is running locally");
  }
  await invoke("install_official_plugin", { pluginId, homeId });
}

export async function removeOfficialPlugin(pluginId: string, homeId: string): Promise<void> {
  if (!hasLocalBackend) {
    throw new Error("Official plugins are available when Remote AI is running locally");
  }
  await invoke("remove_official_plugin", { pluginId, homeId });
}

export async function setOfficialPluginEnabled(pluginId: string, enabled: boolean, homeId: string): Promise<void> {
  if (!hasLocalBackend) {
    throw new Error("Official plugins are available when Remote AI is running locally");
  }
  await invoke("set_official_plugin_enabled", { pluginId, enabled, homeId });
}

export function skillPreviewUrl(baseUrl: string | null | undefined, skill: SkillMarketItem) {
  if (!skill.hasPreview || !baseUrl) return null;
  return `${baseUrl.replace(/\/+$/, "")}/skills/${encodeURIComponent(skill.id)}/preview`;
}

export async function changeCloudPassword(currentPassword: string, newPassword: string): Promise<void> {
  if (!hasLocalBackend) {
    if (!previewCloudState().authenticated) throw new Error("Cloud account is not signed in");
    if (currentPassword.length < 6) throw new Error("Current password must be at least 6 characters");
    if (newPassword.length < 8) throw new Error("New password must be at least 8 characters");
    return;
  }
  await invoke("cloud_change_password", { currentPassword, newPassword });
}

export async function logoutCloud(): Promise<CloudAuthState> {
  if (!hasLocalBackend) {
    window.localStorage.removeItem(CLOUD_USER_PREVIEW_KEY);
    return previewCloudState();
  }
  return invoke<CloudAuthState>("cloud_logout");
}

export async function syncCloudAccounts(): Promise<CloudSyncResult> {
  if (!hasLocalBackend) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_sync_accounts");
}

export async function pushCloudAccounts(): Promise<CloudSyncResult> {
  if (!hasLocalBackend) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_push_accounts");
}

export async function pushCloudAccount(id: string, restoreDeleted = false): Promise<CloudSyncResult> {
  if (!hasLocalBackend) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_push_account", { id, restoreDeleted });
}

export async function pullCloudAccount(id: string): Promise<CloudSyncResult> {
  if (!hasLocalBackend) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_pull_account", { id });
}

export async function syncCloudTotp(vault: TotpVault): Promise<TotpVault> {
  if (!hasLocalBackend) return vault;
  return invoke<TotpVault>("cloud_sync_totp", {
    entries: vault.entries,
    tombstones: vault.tombstones,
    modifiedAt: vault.modifiedAt,
  });
}

export async function pullCloudTotp(): Promise<TotpVault | null> {
  if (!hasLocalBackend) return null;
  const response = await invoke<TotpVault & { modifiedAt: string | null }>("cloud_pull_totp");
  return response.modifiedAt === null ? null : response;
}

export async function pushCloudProviders(): Promise<CloudSyncResult> {
  if (!hasLocalBackend) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_push_providers");
}

export async function pushCloudProvider(id: string): Promise<CloudSyncResult> {
  if (!hasLocalBackend) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_push_provider", { id });
}

export async function deleteCloudAccount(id: string): Promise<CloudSyncResult> {
  if (!hasLocalBackend) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_delete_account", { id });
}

export async function loadDeletedCloudAccounts(): Promise<DeletedCloudAccount[]> {
  if (!hasLocalBackend) return [];
  return invoke<DeletedCloudAccount[]>("cloud_list_deleted_accounts");
}

export async function restoreDeletedCloudAccount(id: string): Promise<CloudSyncResult> {
  if (!hasLocalBackend) return { uploaded: 0, downloaded: 1 };
  return invoke<CloudSyncResult>("cloud_restore_deleted_account", { id });
}

export async function loadDeletedCloudProviders(): Promise<DeletedCloudProvider[]> {
  if (!hasLocalBackend) return [];
  return invoke<DeletedCloudProvider[]>("cloud_list_deleted_providers");
}

export async function restoreDeletedCloudProvider(id: string): Promise<CloudSyncResult> {
  if (!hasLocalBackend) return { uploaded: 0, downloaded: 1 };
  return invoke<CloudSyncResult>("cloud_restore_deleted_provider", { id });
}

export async function deleteCloudProvider(id: string): Promise<CloudSyncResult> {
  if (!hasLocalBackend) return { uploaded: 0, downloaded: 0 };
  return invoke<CloudSyncResult>("cloud_delete_provider", { id });
}

export async function resizeFloatingBubble(expanded: boolean): Promise<void> {
  if (isDesktopApp) await invoke("resize_floating_bubble", { expanded });
}

export type FloatingUsageWindowMode = "classic" | "glass" | "providerCard" | "concurrentCard";

export async function resizeFloatingUsageWindow(mode: FloatingUsageWindowMode): Promise<void> {
  if (isDesktopApp) await invoke("resize_floating_usage_window", { mode });
}

export async function dragFloatingBubble(): Promise<void> {
  if (isDesktopApp) await invoke("drag_floating_bubble");
}

export async function showFloatingBubbleMenu(position: { x: number; y: number }): Promise<void> {
  if (isDesktopApp) await invoke("show_floating_bubble_menu", { position });
}

export async function showDashboardFromBubble(): Promise<void> {
  if (isDesktopApp) await invoke("show_dashboard_from_bubble");
}

export async function beginLogin(embedded: boolean, privateMode = false): Promise<LoginStart | null> {
  if (!isDesktopApp) return null;
  return invoke<LoginStart>("start_login", { embedded, privateMode });
}

export async function beginWebSessionLogin(): Promise<void> {
  if (isDesktopApp) await invoke("start_web_session_login");
}

export type ImportAuthResult =
  | { status: "imported"; id: string }
  | { status: "cancelled" }
  | { status: "preview" };

export type CompatibleJsonImportResult =
  | { status: "imported"; ids: string[]; skipped: string[] }
  | { status: "cancelled" }
  | { status: "preview" };

export type ExportAccountArchiveResult =
  | { status: "exported"; path: string }
  | { status: "cancelled" }
  | { status: "preview" };

export type ImportAccountArchiveResult =
  | { status: "imported"; result: AccountArchiveImportResult }
  | { status: "cancelled" }
  | { status: "preview" };

export type ExportDiagnosticLogsResult =
  | { status: "exported"; path: string }
  | { status: "cancelled" }
  | { status: "preview" };

export async function chooseAndImportAuth(): Promise<ImportAuthResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{ name: "Codex auth.json", extensions: ["json"] }],
  });
  if (!selected) return { status: "cancelled" };
  const id = await invoke<string>("import_auth_file", { path: selected });
  return { status: "imported", id };
}

export async function importAccountJsonText(content: string): Promise<CompatibleJsonImportResult> {
  if (!hasLocalBackend) return { status: "preview" };
  const result = await invoke<{ importedIds: string[]; skipped: string[] }>("import_account_json_text", { content });
  return { status: "imported", ids: result.importedIds, skipped: result.skipped };
}

export async function chooseAndImportAccountJson(): Promise<CompatibleJsonImportResult> {
  if (isHostedWebApp) {
    const content = await chooseBrowserAccountFile();
    return content === null ? { status: "cancelled" } : importAccountJsonText(content);
  }
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{ name: "Codex account JSON", extensions: ["json", "jsonl", "ndjson"] }],
  });
  if (!selected) return { status: "cancelled" };
  const result = await invoke<{ importedIds: string[]; skipped: string[] }>("import_account_json_file", { path: selected });
  return { status: "imported", ids: result.importedIds, skipped: result.skipped };
}

export async function importAccountJsonFromClipboard(): Promise<CompatibleJsonImportResult> {
  if (!isDesktopApp) return { status: "preview" };
  const result = await invoke<{ importedIds: string[]; skipped: string[] }>(
    "import_account_json_from_clipboard",
  );
  return { status: "imported", ids: result.importedIds, skipped: result.skipped };
}

export async function chooseAndImportCompatibleJson(): Promise<CompatibleJsonImportResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{ name: "Compatible Codex JSON", extensions: ["json"] }],
  });
  if (!selected) return { status: "cancelled" };
  const result = await invoke<{ importedIds: string[]; skipped: string[] }>("import_compatible_json_file", { path: selected });
  return { status: "imported", ids: result.importedIds, skipped: result.skipped };
}

export async function setLocalProxyListenOnAllInterfaces(
  enabled: boolean,
  apiKey?: string,
): Promise<LocalProxyStatus> {
  if (!hasLocalBackend) {
    if (!previewLocalProxyStatus().running) {
      throw new Error("Start the local proxy before changing its listening address");
    }
    const normalizedApiKey = apiKey?.trim();
    if (enabled && !normalizedApiKey && !previewLocalProxyStatus().hasLanApiKey) {
      throw new Error("API key is required before listening on the local network");
    }
    if (normalizedApiKey) {
      previewSetLegacyLanApiKey(normalizedApiKey);
    }
    window.localStorage.setItem(LOCAL_PROXY_LISTEN_ALL_INTERFACES_PREVIEW_KEY, String(enabled));
    return previewLocalProxyStatus();
  }
  return invoke<LocalProxyStatus>("set_local_proxy_listen_on_all_interfaces", { enabled, apiKey });
}

export async function chooseAndImportSub2apiJson(): Promise<CompatibleJsonImportResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{ name: "sub2api export JSON", extensions: ["json"] }],
  });
  if (!selected) return { status: "cancelled" };
  const result = await invoke<{ importedIds: string[]; skipped: string[] }>("import_sub2api_json_file", { path: selected });
  return { status: "imported", ids: result.importedIds, skipped: result.skipped };
}

export async function chooseAndExportAccountArchive(): Promise<ExportAccountArchiveResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await save({
    defaultPath: `codex-switch-backup-${new Date().toISOString().slice(0, 10)}.cs`,
    filters: [{ name: "Remote AI backup", extensions: ["cs"] }],
  });
  if (!selected) return { status: "cancelled" };
  const path = await invoke<string>("export_accounts_archive", { path: selected });
  return { status: "exported", path };
}

export async function chooseAndImportAccountArchive(): Promise<ImportAccountArchiveResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{ name: "Remote AI backup", extensions: ["cs"] }],
  });
  if (!selected) return { status: "cancelled" };
  const result = await invoke<AccountArchiveImportResult>("import_accounts_archive", { path: selected });
  return { status: "imported", result };
}

export async function chooseAndExportDiagnosticLogs(): Promise<ExportDiagnosticLogsResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await save({
    defaultPath: `codex-switch-diagnostics-${new Date().toISOString().slice(0, 10)}.jsonl`,
    filters: [{ name: "Remote AI diagnostics", extensions: ["jsonl"] }],
  });
  if (!selected) return { status: "cancelled" };
  const path = await invoke<string>("export_diagnostic_logs", { path: selected });
  return { status: "exported", path };
}

export async function activateAccount(id: string): Promise<void> {
  if (!hasLocalBackend) {
    writePreviewProviders(readPreviewProviders().map((provider) => ({ ...provider, active: false })));
    return;
  }
  await invoke("switch_account_and_restart_chatgpt", { id });
}

export async function deactivateAccount(): Promise<void> {
  if (hasLocalBackend) await invoke("deactivate_account_and_restart_chatgpt");
}

export async function copyAccountAuthJson(id: string): Promise<void> {
  if (!isDesktopApp) throw new Error("Copying auth.json requires the desktop app");
  await invoke("copy_account_auth_json", { id });
}

export async function setAccountAutoSwitchEnabled(id: string, enabled: boolean): Promise<void> {
  if (hasLocalBackend) await invoke("set_account_auto_switch_enabled", { id, enabled });
}

export async function setAccountAutoSwitchPriority(id: string, priority: number): Promise<void> {
  if (!Number.isInteger(priority)) throw new Error("Auto-switch priority must be an integer");
  if (hasLocalBackend) await invoke("set_account_auto_switch_priority", { id, priority });
}

export async function setAccountGroup(id: string, group: string): Promise<string> {
  const normalized = group.trim();
  if (!hasLocalBackend) return normalized;
  return invoke<string>("set_account_group", { id, group: normalized });
}

export async function fetchCloudCurrencyRates(): Promise<CloudCurrencyRates> {
  if (hasLocalBackend) {
    const rates = await invoke<CloudCurrencyRates>("fetch_cloud_currency_rates");
    return includeBaseCurrency(rates);
  }
  const { baseUrl } = previewCloudState();
  if (!baseUrl) return includeBaseCurrency({ currencies: [], updatedAt: null });
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/currency-rates`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Currency rate request failed with HTTP ${response.status}`);
  return includeBaseCurrency(await response.json() as CloudCurrencyRates);
}

function includeBaseCurrency(rates: CloudCurrencyRates): CloudCurrencyRates {
  const result = {
    ...rates,
    currencies: [
      BASE_CURRENCY_RATE,
      ...rates.currencies.filter((currency) => currency.code !== BASE_CURRENCY_RATE.code),
    ],
  };
  cacheDisplayCurrencyRates(result.currencies);
  return result;
}

export async function setAccountAutoSwitchThreshold(id: string, threshold: number): Promise<void> {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error("Auto-switch threshold must be between 0 and 100");
  }
  if (hasLocalBackend) await invoke("set_account_auto_switch_threshold", { id, threshold });
}

export async function refreshAccountUsage(id: string): Promise<void> {
  if (hasLocalBackend) await invoke("refresh_usage", { id });
}

export async function consumeAccountQuota(id: string): Promise<void> {
  if (hasLocalBackend) await invoke("consume_account_quota", { id });
}

export async function removeAccount(id: string): Promise<void> {
  if (hasLocalBackend) await invoke("delete_account", { id });
}

export async function updateAccountNote(id: string, details: AccountDetailsDraft): Promise<void> {
  if (hasLocalBackend) await invoke("update_account_note", { input: { id, ...details } });
}

export async function fetchResetCredits(id: string): Promise<ResetCreditsSummary> {
  if (hasLocalBackend) return invoke<ResetCreditsSummary>("fetch_reset_credits", { id });
  return {
    credits: [{
      issuedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 27 * 24 * 60 * 60_000).toISOString(),
    }],
  };
}

export async function consumeResetCredit(id: string): Promise<void> {
  if (hasLocalBackend) await invoke("consume_reset_credit", { id });
}

export async function restartChatGpt(): Promise<void> {
  if (hasLocalBackend) await invoke("restart_chatgpt");
}

export async function loadCodexConnectionStatus(): Promise<CodexConnectionStatus> {
  if (hasLocalBackend) return invoke<CodexConnectionStatus>("get_codex_connection_status");
  return { state: "unsupported" };
}

export async function connectCodex(): Promise<CodexConnectResult> {
  if (hasLocalBackend) return invoke<CodexConnectResult>("connect_codex");
  return { state: "unsupported", restartRequired: false };
}

export async function launchChatGpt(): Promise<boolean> {
  if (hasLocalBackend) return invoke<boolean>("launch_chatgpt");
  return false;
}

export async function launchClaudeCode(): Promise<boolean> {
  if (hasLocalBackend) return invoke<boolean>("launch_claude_code");
  return false;
}

export async function restartClaudeCode(): Promise<void> {
  if (hasLocalBackend) await invoke("restart_claude_code");
}

export async function launchOpenCode(): Promise<boolean> {
  if (hasLocalBackend) return invoke<boolean>("launch_open_code");
  return false;
}

export async function restartOpenCode(): Promise<void> {
  if (hasLocalBackend) await invoke("restart_open_code");
}

export async function openManagedFolder(target: "codexHome" | "accountStore"): Promise<void> {
  if (hasLocalBackend) await invoke("open_managed_folder", { target });
}

export async function loadDreamSkinStatus(): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) return {
    ...previewDreamSkinStatus(),
    available: previewLocalProxyStatus().running
      || window.localStorage.getItem(NON_PROXY_ENHANCEMENTS_PREVIEW_KEY) !== "false",
  };
  return invoke<DreamSkinStatus>("get_dream_skin_status");
}

export async function installDreamSkin(): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(DREAM_SKIN_INSTALLED_PREVIEW_KEY, "true");
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("install_dream_skin");
}

export async function applyDreamSkinTheme(themeId: string): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(DREAM_SKIN_INSTALLED_PREVIEW_KEY, "true");
    window.localStorage.setItem(DREAM_SKIN_SESSION_PREVIEW_KEY, "active");
    window.localStorage.setItem(DREAM_SKIN_THEME_PREVIEW_KEY, themeId);
    window.localStorage.setItem(
      DREAM_SKIN_APPEARANCE_PREVIEW_KEY,
      DREAM_SKIN_PREVIEW_THEME_APPEARANCES[themeId] ?? "auto",
    );
    window.localStorage.removeItem(DREAM_SKIN_OVERLAY_OPACITY_PREVIEW_KEY);
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("apply_dream_skin_theme", { themeId });
}

export type ChooseDreamSkinImageResult =
  | { status: "selected"; path: string }
  | { status: "cancelled" }
  | { status: "preview" };

export async function chooseDreamSkinImage(): Promise<ChooseDreamSkinImageResult> {
  if (!isDesktopApp) return { status: "preview" };
  const selected = await open({
    multiple: false,
    filters: [{
      name: "Dream Skin image",
      extensions: ["png", "jpg", "jpeg", "webp", "heic", "tif", "tiff"],
    }],
  });
  return selected ? { status: "selected", path: selected } : { status: "cancelled" };
}

export async function importDreamSkinImage(
  path: string,
  options: DreamSkinImportOptions,
): Promise<DreamSkinStatus> {
  if (!isDesktopApp) {
    window.localStorage.setItem(DREAM_SKIN_INSTALLED_PREVIEW_KEY, "true");
    window.localStorage.setItem(DREAM_SKIN_SESSION_PREVIEW_KEY, "active");
    window.localStorage.setItem(DREAM_SKIN_THEME_PREVIEW_KEY, "custom");
    window.localStorage.setItem(DREAM_SKIN_APPEARANCE_PREVIEW_KEY, options.appearance);
    window.localStorage.removeItem(DREAM_SKIN_OVERLAY_OPACITY_PREVIEW_KEY);
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("import_dream_skin_image", { path, options });
}

export async function saveDreamSkinTheme(name: string): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) return previewDreamSkinStatus();
  return invoke<DreamSkinStatus>("save_dream_skin_theme", { name });
}

export async function deleteDreamSkinThemes(themeIds: string[]): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) return previewDreamSkinStatus();
  return invoke<DreamSkinStatus>("delete_dream_skin_themes", { themeIds });
}

export async function setDreamSkinAppearance(appearance: DreamSkinAppearance): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(DREAM_SKIN_APPEARANCE_PREVIEW_KEY, appearance);
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("set_dream_skin_appearance", { appearance });
}

export async function setDreamSkinOverlayOpacity(opacity: number): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(DREAM_SKIN_OVERLAY_OPACITY_PREVIEW_KEY, String(opacity));
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("set_dream_skin_overlay_opacity", { opacity });
}

export async function setDreamSkinPaused(paused: boolean): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(DREAM_SKIN_SESSION_PREVIEW_KEY, paused ? "paused" : "active");
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("set_dream_skin_paused", { paused });
}

export async function reapplyDreamSkin(): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) {
    window.localStorage.setItem(DREAM_SKIN_SESSION_PREVIEW_KEY, "active");
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("reapply_dream_skin");
}

export async function verifyDreamSkin(): Promise<string> {
  if (!hasLocalBackend) return "Preview verification completed.";
  return invoke<string>("verify_dream_skin");
}

export async function restoreDreamSkin(): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) {
    window.localStorage.removeItem(DREAM_SKIN_INSTALLED_PREVIEW_KEY);
    window.localStorage.removeItem(DREAM_SKIN_SESSION_PREVIEW_KEY);
    window.localStorage.removeItem(DREAM_SKIN_THEME_PREVIEW_KEY);
    window.localStorage.removeItem(DREAM_SKIN_APPEARANCE_PREVIEW_KEY);
    window.localStorage.removeItem(DREAM_SKIN_OVERLAY_OPACITY_PREVIEW_KEY);
    return previewDreamSkinStatus();
  }
  return invoke<DreamSkinStatus>("restore_dream_skin");
}

export async function openDreamSkinFolder(): Promise<void> {
  if (hasLocalBackend) await invoke("open_dream_skin_folder");
}

export async function loadDreamSkinThemePreview(themeId: string): Promise<string | null> {
  if (!hasLocalBackend) return null;
  return invoke<string | null>("get_dream_skin_theme_preview", { themeId });
}

export async function loadDreamSkinMarket(): Promise<DreamSkinMarketResult> {
  if (hasLocalBackend) return invoke<DreamSkinMarketResult>("get_dream_skin_market");
  const response = await fetch(DREAM_SKIN_MARKET_INDEX_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Community theme market returned HTTP ${response.status}`);
  const manifest = await response.json() as {
    schemaVersion: number;
    updated_at?: string;
    updatedAt?: string;
    themes: Array<Omit<DreamSkinMarketResult["themes"][number],
      "sourceUrl" | "themeSha256" | "imageSha256" | "previewUrl" | "installed" | "installedVersion" | "updateAvailable"> & {
        source_url: string;
        theme_sha256: string;
        image_sha256: string;
      }>;
  };
  return {
    schemaVersion: manifest.schemaVersion,
    updatedAt: manifest.updatedAt || manifest.updated_at || "",
    repositoryUrl: DREAM_SKIN_MARKET_REPOSITORY_URL,
    cached: false,
    warning: null,
    themes: manifest.themes.map((theme) => ({
      ...theme,
      sourceUrl: theme.source_url,
      themeSha256: theme.theme_sha256,
      imageSha256: theme.image_sha256,
      previewUrl: new URL(theme.preview, DREAM_SKIN_MARKET_ASSET_ROOT).href,
      installed: false,
      installedVersion: null,
      updateAvailable: false,
    })),
  };
}

export async function installDreamSkinMarketTheme(themeId: string): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) return previewDreamSkinStatus();
  return invoke<DreamSkinStatus>("install_dream_skin_market_theme", { themeId });
}

export async function loadDreamSkinCommunityPage(offset: number, limit: number): Promise<DreamSkinCommunityPage> {
  if (hasLocalBackend) {
    return invoke<DreamSkinCommunityPage>("get_dream_skin_community_page", { offset, limit });
  }
  const url = new URL("/v1/themes", DREAM_SKIN_COMMUNITY_API_ORIGIN);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("sort", "recent");
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`DreamSkin community returned HTTP ${response.status}`);
  const result = await response.json() as Pick<DreamSkinCommunityPage, "items" | "total">;
  return {
    ...result,
    offset,
    limit,
    cached: false,
    warning: null,
    items: result.items.map((item) => ({
      ...item,
      previewUrl: `${DREAM_SKIN_COMMUNITY_API_ORIGIN}/v1/themes/${encodeURIComponent(item.id)}/preview/thumbnail`,
      installed: false,
      installedVersion: null,
      updateAvailable: false,
    })),
  };
}

export async function installDreamSkinCommunityTheme(versionId: string): Promise<DreamSkinStatus> {
  if (!hasLocalBackend) return previewDreamSkinStatus();
  return invoke<DreamSkinStatus>("install_dream_skin_community_theme", { versionId });
}

export function checkForUpdate({
  force = false,
  replacePending = false,
}: { force?: boolean; replacePending?: boolean } = {}): Promise<UpdateInfo | null> {
  if (!isDesktopApp) return Promise.resolve(null);
  if (pendingAppUpdate && replacePending && !updateDownloadPromise && !updateInstallInProgress) {
    if (updateCheckPromise) return updateCheckPromise;
    const request = refreshPendingAppUpdate();
    trackUpdateCheck(request);
    return request;
  }
  if (pendingAppUpdate && force) return Promise.resolve(toUpdateInfo(pendingAppUpdate));
  if (pendingAppUpdate) return Promise.resolve(toUpdateInfo(pendingAppUpdate));
  if (updateCheckPromise) return updateCheckPromise;

  const request = getAvailableAppUpdate();
  trackUpdateCheck(request);
  return request;
}

function trackUpdateCheck(request: Promise<UpdateInfo | null>) {
  updateCheckPromise = request;
  void request.then(
    () => { if (updateCheckPromise === request) updateCheckPromise = null; },
    () => { if (updateCheckPromise === request) updateCheckPromise = null; },
  );
}

async function getAvailableAppUpdate(): Promise<UpdateInfo | null> {
  const update = await checkAvailableAppUpdate();
  pendingAppUpdate = update;
  if (!update) return null;
  return toUpdateInfo(update);
}

function toUpdateInfo(update: Update): UpdateInfo {
  return {
    currentVersion: update.currentVersion,
    latestVersion: update.version,
    releaseName: `Remote AI v${update.version}`,
    releaseNotes: update.body ?? null,
    releaseUrl: RELEASES_URL,
  };
}

async function refreshPendingAppUpdate(): Promise<UpdateInfo | null> {
  const currentUpdate = pendingAppUpdate;
  if (!currentUpdate) return getAvailableAppUpdate();

  const candidate = await checkAvailableAppUpdate();
  if (!candidate) return toUpdateInfo(currentUpdate);

  if (
    pendingAppUpdate !== currentUpdate
    || updateDownloadPromise
    || updateInstallInProgress
    || !isVersionNewer(candidate.version, currentUpdate.version)
  ) {
    await candidate.close();
    return pendingAppUpdate ? toUpdateInfo(pendingAppUpdate) : null;
  }

  await currentUpdate.close();
  pendingAppUpdate = candidate;
  appUpdateDownloaded = false;
  return toUpdateInfo(candidate);
}

function isVersionNewer(candidate: string, current: string): boolean {
  const parse = (version: string) => {
    const [withoutBuild] = version.replace(/^v/i, "").split("+", 1);
    const [core, prerelease] = withoutBuild.split("-", 2);
    return {
      core: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
      prerelease: prerelease?.split(".") ?? [],
    };
  };
  const left = parse(candidate);
  const right = parse(current);
  const coreLength = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  if (left.prerelease.length === 0) return right.prerelease.length > 0;
  if (right.prerelease.length === 0) return false;
  const prereleaseLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return false;
    if (rightPart === undefined) return true;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber;
    if (leftNumber !== null) return false;
    if (rightNumber !== null) return true;
    return leftPart > rightPart;
  }
  return false;
}

export async function downloadAvailableUpdate(onProgress?: (progress: number | null) => void): Promise<void> {
  if (!isDesktopApp) return;
  if (appUpdateDownloaded) return;
  if (updateDownloadPromise) return updateDownloadPromise;

  const download = async () => {
    const info = pendingAppUpdate ? toUpdateInfo(pendingAppUpdate) : await getAvailableAppUpdate();
    const update = pendingAppUpdate;
    if (!info || !update) return;

    let downloadedBytes = 0;
    let totalBytes: number | undefined;
    const reportProgress = (event: DownloadEvent) => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength;
        onProgress?.(totalBytes ? 0 : null);
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        onProgress?.(totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null);
      } else if (event.event === "Finished") {
        onProgress?.(100);
      }
    };

    try {
      await update.download(reportProgress);
      appUpdateDownloaded = true;
      rememberPendingAppUpdate(update.version);
    } catch (error) {
      await update.close();
      if (pendingAppUpdate === update) pendingAppUpdate = null;
      throw error;
    }
  };

  const request = download();
  updateDownloadPromise = request;
  try {
    await request;
  } finally {
    if (updateDownloadPromise === request) updateDownloadPromise = null;
  }
}

export async function installDownloadedUpdate(expectedVersion?: string): Promise<void> {
  if (!isDesktopApp) return;
  if (updateInstallInProgress) return;
  const update = pendingAppUpdate;
  if (!update || !appUpdateDownloaded) throw new Error("The update has not finished downloading");
  if (expectedVersion && update.version !== expectedVersion) throw new Error("The available update has changed");

  updateInstallInProgress = true;
  forgetPendingAppUpdate();
  try {
    await update.install();
    await update.close();
    pendingAppUpdate = null;
    appUpdateDownloaded = false;
    await relaunch();
  } catch (error) {
    rememberPendingAppUpdate(update.version);
    updateInstallInProgress = false;
    throw error;
  }
}

function readPendingAppUpdateVersion(): string | null {
  try {
    return window.localStorage.getItem(PENDING_APP_UPDATE_VERSION_KEY);
  } catch {
    return null;
  }
}

function rememberPendingAppUpdate(version: string) {
  try {
    window.localStorage.setItem(PENDING_APP_UPDATE_VERSION_KEY, version);
  } catch {
    // The downloaded update remains installable in the current session when storage is unavailable.
  }
}

function forgetPendingAppUpdate() {
  try {
    window.localStorage.removeItem(PENDING_APP_UPDATE_VERSION_KEY);
  } catch {
    // A stale marker is cleared after the installed version no longer has an available update.
  }
}

export function hasPendingAppUpdateInstall(): boolean {
  return isDesktopApp && isAutoUpdateEnabled() && readPendingAppUpdateVersion() !== null;
}

export function installPendingAppUpdateOnLaunch(): Promise<void> {
  if (!hasPendingAppUpdateInstall()) return Promise.resolve();
  if (pendingUpdateInstallPromise) return pendingUpdateInstallPromise;

  const install = async () => {
    const update = await checkForUpdate({ force: true });
    if (!update) {
      forgetPendingAppUpdate();
      return;
    }
    if (!hasPendingAppUpdateInstall()) return;
    await downloadAvailableUpdate();
    if (!hasPendingAppUpdateInstall()) return;
    await installDownloadedUpdate();
  };
  const request = install();
  pendingUpdateInstallPromise = request;
  void request.finally(() => {
    if (pendingUpdateInstallPromise === request) pendingUpdateInstallPromise = null;
  }).catch(() => undefined);
  return request;
}

const HOSTED_BACKEND_POLL_INTERVAL_MS = 2_500;

function pollHostedBackend(callback: () => void | Promise<void>): () => void {
  let running = false;
  const poll = async () => {
    if (running) return;
    running = true;
    try {
      await callback();
    } catch {
      // A later poll will retry after transient local-server errors.
    } finally {
      running = false;
    }
  };
  const timer = window.setInterval(() => void poll(), HOSTED_BACKEND_POLL_INTERVAL_MS);
  return () => window.clearInterval(timer);
}

export function subscribeToBackendEvents(
  onAccountsChanged: () => void,
  onLoginStatus: (status: LoginStatus) => void,
): () => void {
  if (isHostedWebApp) return pollHostedBackend(onAccountsChanged);
  if (!isDesktopApp) return () => undefined;

  const subscriptions: Promise<UnlistenFn>[] = [
    listen("accounts-changed", onAccountsChanged),
    listen<LoginStatus>("login-status", ({ payload }) => onLoginStatus(payload)),
  ];
  return () => subscriptions.forEach((subscription) => void subscription.then((unlisten) => unlisten()));
}

export function subscribeToTokenUsageChanges(onChange: () => void): () => void {
  if (isHostedWebApp) return pollHostedBackend(onChange);
  if (!isDesktopApp) return () => undefined;
  const subscription = listen("token-usage-updated", onChange);
  return () => void subscription.then((unlisten) => unlisten());
}

export async function publishTotpChange(vault: TotpVault): Promise<void> {
  if (isDesktopApp) {
    await emit(TOTP_EVENT, vault);
    return;
  }
  window.dispatchEvent(new CustomEvent<TotpVault>(TOTP_EVENT, { detail: vault }));
}

function validatedTotpVault(value: unknown): TotpVault | null {
  return normalizeTotpVault(value);
}

export function subscribeToTotpChanges(onChange: (vault: TotpVault) => void): () => void {
  const handleVault = (value: unknown) => {
    const vault = validatedTotpVault(value);
    if (vault) onChange(vault);
  };
  if (isDesktopApp) {
    const subscription = listen<TotpVault>(TOTP_EVENT, ({ payload }) => handleVault(payload));
    return () => void subscription.then((unlisten) => unlisten());
  }
  const handleEvent = (event: Event) => handleVault((event as CustomEvent<TotpVault>).detail);
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== TOTP_STORAGE_KEY || !event.newValue) return;
    try { handleVault(JSON.parse(event.newValue)); } catch { /* Ignore invalid external storage values. */ }
  };
  window.addEventListener(TOTP_EVENT, handleEvent);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(TOTP_EVENT, handleEvent);
    window.removeEventListener("storage", handleStorage);
  };
}

export function subscribeToCloudSessionExpired(onExpired: () => void): () => void {
  if (isHostedWebApp) {
    let expired = false;
    return pollHostedBackend(async () => {
      const state = await loadCloudAuthState();
      if (state.sessionExpired && !expired) onExpired();
      expired = state.sessionExpired;
    });
  }
  if (!isDesktopApp) return () => undefined;
  const subscription = listen("cloud-session-expired", onExpired);
  return () => void subscription.then((unlisten) => unlisten());
}

export function subscribeToThemeColorChanges(onChange: (color: string) => void): () => void {
  if (isHostedWebApp) {
    let previous: string | null = null;
    return pollHostedBackend(async () => {
      const color = normalizeThemeColor((await loadAppSettings()).themeColor ?? DEFAULT_THEME_COLOR);
      if (previous !== null && color !== previous) onChange(color);
      previous = color;
    });
  }
  if (!isDesktopApp) {
    const handleThemeChange = (event: Event) => {
      onChange(normalizeThemeColor((event as CustomEvent<string>).detail));
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_COLOR_PREVIEW_KEY) onChange(normalizeThemeColor(event.newValue));
    };
    window.addEventListener(THEME_COLOR_EVENT, handleThemeChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(THEME_COLOR_EVENT, handleThemeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }

  const subscription = listen<string>("theme-color-changed", ({ payload }) => {
    onChange(normalizeThemeColor(payload));
  });
  return () => void subscription.then((unlisten) => unlisten());
}

export function subscribeToBubbleResetDisplayChanges(
  onChange: (display: BubbleResetDisplay) => void,
): () => void {
  const handleChange = (value: unknown) => {
    if (value === "countdown" || value === "resetAt") onChange(value);
  };
  if (isHostedWebApp) {
    let previous: BubbleResetDisplay | null = null;
    return pollHostedBackend(async () => {
      const display = (await loadAppSettings()).bubbleResetDisplay;
      if (previous !== null && display !== previous) handleChange(display);
      previous = display;
    });
  }
  if (!isDesktopApp) {
    const handleDisplayChange = (event: Event) => {
      handleChange((event as CustomEvent<BubbleResetDisplay>).detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === BUBBLE_RESET_DISPLAY_PREVIEW_KEY) handleChange(event.newValue);
    };
    window.addEventListener(BUBBLE_RESET_DISPLAY_EVENT, handleDisplayChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(BUBBLE_RESET_DISPLAY_EVENT, handleDisplayChange);
      window.removeEventListener("storage", handleStorage);
    };
  }

  const subscription = listen<BubbleResetDisplay>(BUBBLE_RESET_DISPLAY_EVENT, ({ payload }) => {
    handleChange(payload);
  });
  return () => void subscription.then((unlisten) => unlisten());
}

export function subscribeToFloatingBubbleChanges(onChange: (enabled: boolean) => void): () => void {
  if (!isDesktopApp) return () => undefined;
  let active = true;
  const subscription = listen<boolean>("floating-bubble-enabled-changed", ({ payload }) => {
    if (active && typeof payload === "boolean") onChange(payload);
  });
  return () => {
    active = false;
    void subscription.then((unlisten) => unlisten());
  };
}

export function subscribeToBubbleStyleChanges(onChange: (style: BubbleStyle) => void): () => void {
  const handleChange = (value: unknown) => {
    if (value === "classic" || value === "glass") onChange(value);
  };
  if (isHostedWebApp) {
    let previous: BubbleStyle | null = null;
    return pollHostedBackend(async () => {
      const style = (await loadAppSettings()).bubbleStyle;
      if (previous !== null && style !== previous) handleChange(style);
      previous = style;
    });
  }
  if (!isDesktopApp) {
    const handleStyleChange = (event: Event) => handleChange((event as CustomEvent<BubbleStyle>).detail);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === BUBBLE_STYLE_PREVIEW_KEY) handleChange(event.newValue);
    };
    window.addEventListener(BUBBLE_STYLE_EVENT, handleStyleChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(BUBBLE_STYLE_EVENT, handleStyleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }
  const subscription = listen<BubbleStyle>(BUBBLE_STYLE_EVENT, ({ payload }) => handleChange(payload));
  return () => void subscription.then((unlisten) => unlisten());
}

export function subscribeToProviderEvents(onProvidersChanged: () => void | Promise<void>): () => void {
  let active = true;
  const onChange = () => {
    if (active) return onProvidersChanged();
  };
  let unsubscribe: () => void;
  if (isHostedWebApp) {
    unsubscribe = pollHostedBackend(onChange);
  } else if (!isDesktopApp) {
    window.addEventListener(PROVIDERS_EVENT, onChange);
    unsubscribe = () => window.removeEventListener(PROVIDERS_EVENT, onChange);
  } else {
    const subscription = listen("providers-changed", onChange);
    unsubscribe = () => void subscription.then((unlisten) => unlisten());
  }
  return () => {
    active = false;
    unsubscribe();
  };
}

export interface OfficialModelContextSettings {
  globalContextWindow: number;
  modelContextWindows: Record<string, number>;
  models: string[];
}

export async function refreshOfficialModelCatalog(): Promise<string[]> {
  if (!hasLocalBackend) return [];
  return invoke<string[]>("refresh_official_model_catalog");
}

export async function loadOfficialModelContextSettings(): Promise<OfficialModelContextSettings> {
  await loadGpt56SolContextWindow();
  if (!hasLocalBackend) {
    const settings = await loadAppSettings();
    return {
      globalContextWindow: settings.gpt56SolContextWindow ?? DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW,
      modelContextWindows: settings.officialModelContextWindows ?? {},
      models: Object.keys(settings.officialModelContextWindows ?? {}),
    };
  }
  return invoke<OfficialModelContextSettings>("get_official_model_context_settings");
}

export async function updateOfficialModelContextWindow(
  model: string,
  contextWindow: number | null,
): Promise<OfficialModelContextSettings> {
  if (!hasLocalBackend) {
    const settings = await loadAppSettings();
    const modelContextWindows = { ...(settings.officialModelContextWindows ?? {}) };
    if (contextWindow === null) delete modelContextWindows[model];
    else modelContextWindows[model] = contextWindow;
    window.localStorage.setItem(GPT_5_6_SOL_CONTEXT_WINDOW_LEGACY_KEY, String(
      (settings.gpt56SolContextWindow ?? DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW) / 1_000,
    ));
    return {
      globalContextWindow: settings.gpt56SolContextWindow ?? DEFAULT_GPT_5_6_SOL_CONTEXT_WINDOW,
      modelContextWindows,
      models: Object.keys(modelContextWindows),
    };
  }
  return invoke<OfficialModelContextSettings>("set_official_model_context_window", {
    model,
    contextWindow,
  });
}

export function subscribeToOpenSettings(onOpen: () => void): () => void {
  if (!isDesktopApp) return () => undefined;
  const subscription = listen(OPEN_SETTINGS_EVENT, () => onOpen());
  return () => void subscription.then((unlisten) => unlisten());
}

export async function subscribeToCcSwitchImportRequests(onRequested: () => void): Promise<UnlistenFn> {
  if (!isDesktopApp) return () => undefined;
  return listen(CCSWITCH_IMPORT_REQUESTED_EVENT, onRequested);
}

export async function takeCcSwitchImportRequest(): Promise<CcSwitchImportRequest | null> {
  if (!isDesktopApp) return null;
  return invoke<CcSwitchImportRequest | null>("take_ccswitch_import_request");
}

export async function cancelCcSwitchProviderImport(requestId: string): Promise<void> {
  if (!isDesktopApp) return;
  await invoke("cancel_ccswitch_provider_import", { requestId });
}

export async function confirmCcSwitchProviderImport(
  requestId: string,
  name: string,
): Promise<Provider> {
  return invoke<Provider>("confirm_ccswitch_provider_import", { requestId, name });
}

export async function loadDreamSkinResourcesStatus(): Promise<DreamSkinResourcesStatus> {
  if (!hasLocalBackend) return {
    phase: "ready",
    installed: true,
    installedVersion: "preview",
    availableVersion: "preview",
    downloadedBytes: 1,
    totalBytes: 1,
    error: null,
  };
  return invoke<DreamSkinResourcesStatus>("get_dream_skin_resources_status");
}

export async function retryDreamSkinResources(): Promise<DreamSkinResourcesStatus> {
  if (!hasLocalBackend) return loadDreamSkinResourcesStatus();
  return invoke<DreamSkinResourcesStatus>("retry_dream_skin_resources");
}

export function subscribeToLocalProxyStopProgress(
  onProgress: (progress: LocalProxyStopProgress) => void,
): () => void {
  if (!isDesktopApp) return () => undefined;
  const subscription = listen<LocalProxyStopProgress>(
    "local-proxy-stop-progress",
    ({ payload }) => onProgress(payload),
  );
  return () => void subscription.then((unlisten) => unlisten());
}

export function subscribeToLocalProxyStartProgress(
  onProgress: (progress: LocalProxyStartProgress) => void,
): () => void {
  if (!isDesktopApp) return () => undefined;
  const subscription = listen<LocalProxyStartProgress>(
    "local-proxy-start-progress",
    ({ payload }) => onProgress(payload),
  );
  return () => void subscription.then((unlisten) => unlisten());
}

let languageSave = Promise.resolve();
let languageRevision = 0;

export async function publishLanguageChange(language: Language): Promise<void> {
  const revision = ++languageRevision;
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language); }
  catch { /* A blocked browser store must not prevent the other windows from updating. */ }
  if (!hasLocalBackend) {
    window.dispatchEvent(new CustomEvent<Language>(LANGUAGE_EVENT, { detail: language }));
    return;
  }
  // Preserve tap order across asynchronous storage workers and suppress obsolete broadcasts.
  const saved = languageSave.then(() => invoke<void>("set_app_language", { language }));
  languageSave = saved.catch(() => undefined);
  await saved;
  if (revision !== languageRevision) return;
  if (isDesktopApp) await emit(LANGUAGE_EVENT, language);
  else window.dispatchEvent(new CustomEvent<Language>(LANGUAGE_EVENT, { detail: language }));
}

export function subscribeToLanguageChanges(onChange: (language: Language) => void): () => void {
  const handleLanguage = (value: unknown) => {
    if (isLanguage(value)) onChange(value);
  };
  if (!isDesktopApp) {
    const handleLanguageChange = (event: Event) => {
      handleLanguage((event as CustomEvent<Language>).detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY) handleLanguage(event.newValue);
    };
    window.addEventListener(LANGUAGE_EVENT, handleLanguageChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(LANGUAGE_EVENT, handleLanguageChange);
      window.removeEventListener("storage", handleStorage);
    };
  }

  const subscription = listen<Language>(LANGUAGE_EVENT, ({ payload }) => {
    handleLanguage(payload);
  });
  return () => void subscription.then((unlisten) => unlisten());
}
