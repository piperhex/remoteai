export interface UsageWindow {
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: number | null;
  windowMinutes?: number | null;
}

export interface UsageSummary {
  primary?: UsageWindow | null;
  secondary?: UsageWindow | null;
  credits?: CreditsSnapshot | null;
  apiExpiresAt?: string | null;
  plan?: string | null;
  fetchedAt?: string | null;
  error?: string | null;
}

export interface CreditsSnapshot {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface Account {
  id: string;
  email: string;
  group: string;
  note: string;
  expiresAt: string;
  privateDetails: AccountPrivateDetails;
  plan: string;
  accountId?: string | null;
  active: boolean;
  autoSwitchEnabled: boolean;
  autoSwitchPriority: number;
  autoSwitchThreshold: number;
  localProxyCompatible: boolean;
  directSwitchCompatible: boolean;
  agentIdentity: boolean;
  official: boolean;
  metadataEditable: boolean;
  usage: UsageSummary;
}

export interface AccountPrivateDetails {
  password: string;
  phoneNumber: string;
  totpSecret: string;
}

export interface AccountDetailsDraft {
  note: string;
  expiresAt: string;
  privateDetails: AccountPrivateDetails;
}

export interface ResetCredit {
  issuedAt?: string | null;
  expiresAt?: string | null;
}

export interface AutoResetSettings {
  enabled: boolean;
  accountIds: string[] | null;
  maxCards: number;
  reserveCards: number;
}

export interface ResetCreditsSummary {
  credits: ResetCredit[];
}

export type ResetCreditsLoadState =
  | { status: "loading"; fetchedAt?: string }
  | { status: "loaded"; data: ResetCreditsSummary; fetchedAt: string }
  | { status: "error"; error: string; fetchedAt?: string };

export interface AppInfo {
  codexHome: string;
  authPath: string;
  configPath: string;
  accountStore: string;
  providerStore: string;
  version: string;
}

export type ProviderApiFormat = "openaiResponses" | "openaiChat";
export type ModelApiFormats = Record<string, ProviderApiFormat>;
export type ProviderKind = "custom" | "openai";
export type ProviderBalancePlatform = "newApi" | "sub2Api" | "deepSeek" | "codexSwitch";
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type ModelReasoningEfforts = Record<string, ReasoningEffort[]>;
export type ModelContextWindows = Record<string, number>;
export type ModelTokenCosts = Record<string, number>;

export interface Provider {
  id: string;
  kind: ProviderKind;
  name: string;
  group: string;
  baseUrl: string;
  model: string;
  models: string[];
  modelReasoningEfforts: ModelReasoningEfforts;
  modelContextWindows: ModelContextWindows;
  modelApiFormats: ModelApiFormats;
  modelTokenCosts?: ModelTokenCosts;
  imageInputModels: string[];
  imageInputModelsConfigured: boolean;
  contextWindow?: number | null;
  modelSelectionControlledByCodex: boolean;
  fastModeEnabled: boolean;
  apiFormat: ProviderApiFormat;
  active: boolean;
  autoSwitchEnabled: boolean;
  hasApiKey: boolean;
  supportsDirectSwitch: boolean;
  balancePlatform?: ProviderBalancePlatform | null;
  balanceQueryUrl?: string | null;
  balanceQueryUsesApiKey: boolean;
  hasBalanceQueryToken: boolean;
  walletQueryUrl?: string | null;
  hasWalletQueryToken: boolean;
  walletUsername?: string | null;
  hasWalletLoginCredentials: boolean;
}

export interface ProviderInput {
  id?: string;
  kind: ProviderKind;
  name: string;
  group?: string;
  baseUrl: string;
  model: string;
  models: string[];
  modelReasoningEfforts: ModelReasoningEfforts;
  modelContextWindows: ModelContextWindows;
  modelApiFormats?: ModelApiFormats;
  modelTokenCosts?: ModelTokenCosts;
  imageInputModels: string[];
  imageInputModelsConfigured?: boolean;
  contextWindow?: number | null;
  modelSelectionControlledByCodex: boolean;
  fastModeEnabled?: boolean;
  apiKey?: string;
  apiFormat: ProviderApiFormat;
  balancePlatform?: ProviderBalancePlatform | null;
  balanceQueryUrl?: string | null;
  balanceQueryToken?: string;
  balanceQueryUsesApiKey?: boolean;
  walletQueryUrl?: string | null;
  walletQueryToken?: string;
  walletUsername?: string;
  walletPassword?: string;
}

export interface AggregateApi {
  id: string;
  name: string;
  model: string;
  memberProviderIds: string[];
  enabled: boolean;
  active: boolean;
  memberConversationCounts: Record<string, number>;
}

export interface AggregateApiInput {
  id?: string;
  name: string;
  model: string;
  memberProviderIds: string[];
  enabled: boolean;
}

export interface CcSwitchImportRequest {
  requestId: string;
  app: string;
  name: string;
  endpoint: string;
  models: string[];
  apiKeyProvided: boolean;
  balancePlatform?: ProviderBalancePlatform | null;
}

export interface ProviderBalance {
  apiAmount?: number | null;
  apiUnit: string;
  apiUnlimited: boolean;
  walletAmount?: number | null;
  walletUnit: string;
  walletError?: string | null;
  balanceItems?: ProviderBalanceItem[];
  queriedAt: number;
}

export interface ProviderBalanceItem {
  amount: number;
  unit: string;
}

export interface LocalProxyLanApiKey {
  id: string;
  name: string;
  keyPreview: string;
  enabled: boolean;
  quotaUsd: number | null;
  usedTokens: number;
  usedCostUsd: number;
  remainingUsd: number | null;
  usageIncomplete?: boolean;
  unconfirmedRequests?: number;
  usageReviewThreshold?: number;
}

export interface LocalProxyLanApiKeyInput {
  id?: string;
  name: string;
  apiKey?: string;
  enabled: boolean;
  quotaUsd: number | null;
  acknowledgeUsage?: boolean;
  usageReviewThreshold?: number;
}

export type ProxyServiceTier = "default" | "priority" | "ultrafast";

export interface LocalProxyStatus {
  running: boolean;
  serviceTier?: ProxyServiceTier;
  fastModeEnabled: boolean;
  fastModeAvailable: boolean;
  address: string;
  port: number;
  baseUrl: string;
  autoSwitchOnQuotaExhaustion: boolean;
  concurrentAccountRoutingEnabled: boolean;
  concurrentAccountGroup?: string | null;
  customAutoSwitchPriorityEnabled: boolean;
  customAutoSwitchThresholdEnabled: boolean;
  globalAutoSwitchThreshold: number;
  autoDisableUnreachableAccounts: boolean;
  systemPromptFilterEnabled: boolean;
  systemPromptFilterRules: SystemPromptRule[];
  systemPromptInjectionEnabled: boolean;
  systemPromptInjectionPrompts: SystemPromptRule[];
  listenOnAllInterfaces: boolean;
  hasLanApiKey: boolean;
  imageGenerationAccountId?: string | null;
  imageInputTarget?: ImageModelTarget | null;
  imageOutputTarget?: ImageModelTarget | null;
  openaiAuthAccountId?: string | null;
}

export type ImageModelTarget =
  | { kind: "official"; accountId: string }
  | { kind: "provider"; providerId: string; model: string };

export type ImageRouteKind = "input" | "output";

export type LocalProxyStopPhase =
  | "stoppingClient"
  | "restoringConversations"
  | "skippingConversations"
  | "restoringConfiguration"
  | "restartingClient"
  | "complete"
  | "failed";

export interface LocalProxyStopProgress {
  phase: LocalProxyStopPhase;
  percent: number;
  processedFiles?: number | null;
  totalFiles?: number | null;
}

export type LocalProxyStartPhase =
  | "preparingClient"
  | "startingProxy"
  | "syncingConversations"
  | "restartingClient"
  | "complete"
  | "failed";

export interface LocalProxyStartProgress {
  phase: LocalProxyStartPhase;
  percent: number;
  processedFiles?: number | null;
  totalFiles?: number | null;
}

export interface ProxySession {
  id: string;
  title?: string | null;
  client: string;
  remoteAddress?: string | null;
  connectedAt: number;
  lastSeenAt: number;
  activeRequests: number;
  requestCount: number;
  provider?: string | null;
  concurrentRouted?: boolean;
  accountId?: string | null;
  accountEmail?: string | null;
  model?: string | null;
  contextTokens?: number | null;
  modelContextWindow?: number | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
}

export interface ProxyConversationAttachment {
  id: string;
}

export interface ProxySessionRequest {
    id: number;
    startedAt: number;
    model?: string | null;
    reasoningEffort?: string | null;
    serviceTier?: "default" | "priority" | "ultrafast" | null;
    conversation?: string | null;
    response?: string | null;
    inputAttachments?: ProxyConversationAttachment[];
    outputAttachments?: ProxyConversationAttachment[];
    responseTruncated?: boolean;
    interrupted?: boolean;
    firstResponseTimeMs?: number | null;
    firstTokenTimeMs?: number | null;
    responseTimeMs?: number | null;
    totalTokens?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    reasoningTokens?: number | null;
    cachedTokens?: number | null;
}

export interface ProxySessionLatencySummary {
  totalFirstTokenTimeMs: number;
  firstTokenRequestCount: number;
  totalFirstResponseTimeMs: number;
  requestCount: number;
  totalOutputTokens: number;
  totalOutputTimeMs: number;
  outputRequestCount: number;
}

export interface DirectConversationSyncResult {
  conversationsUpdated: number;
  rolloutFilesUpdated: number;
}

export type CodexThreadKind = "conversation" | "external" | "subagent";

export interface CodexThreadEntry {
  sessionId: string;
  sessionKind: CodexThreadKind;
  title: string;
  cwd: string;
  updatedAt: number | null;
  sizeBytes: number;
  matchExcerpt: string | null;
  accountId: string | null;
  accountEmail: string | null;
  accountActive: boolean;
}

export interface SystemPromptRule {
  name?: string;
  text: string;
  enabled: boolean;
}

export interface CodexThreadTokenTotals {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CodexThreadBinEntry {
  sessionId: string;
  title: string;
  cwd: string;
  deletedAt: number | null;
  sizeBytes: number;
}

export interface CodexThreadMutationReport {
  requestedCount: number;
  affectedCount: number;
  releasedBytes: number;
  message: string;
}

export interface CodexThreadBundleItem {
  sessionId: string;
  title: string;
  cwd: string;
  updatedAt: number | null;
  sizeBytes: number;
  status: "ready" | "duplicate" | "conflict" | "invalid";
  reason: string | null;
}

export interface CodexThreadBundlePreview {
  packageVersion: number;
  exportedAt: string | null;
  totalCount: number;
  readyCount: number;
  totalSizeBytes: number;
  items: CodexThreadBundleItem[];
}

export interface CodexThreadBundleResult {
  requestedCount: number;
  completedCount: number;
  skippedCount: number;
  path: string;
  message: string;
}

export interface CodexThreadVisibilityReport {
  mode: "quick" | "deep" | "sync";
  scannedCount: number;
  rolloutCount: number;
  databaseRowCount: number;
  catalogRowCount: number;
  indexEntryCount: number;
  backupDir: string | null;
  dryRun: boolean;
  message: string;
}

export interface CodexThreadMigrationReport {
  requestedCount: number;
  migratedCount: number;
  skippedCount: number;
  message: string;
}

export interface TokenUsageEntry {
  id: string;
  ts: number;
  provider: string;
  providerId?: string | null;
  accountId?: string | null;
  accountEmail?: string | null;
  model: string;
  serviceTier?: string | null;
  durationMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cachedTokens?: number | null;
  totalTokens?: number | null;
  modelContextWindow?: number | null;
}

export interface AccountTokenUsageTotals {
  accountId?: string | null;
  accountEmail?: string | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  estimatedCost: number;
}

export interface ProviderTokenUsageTotals {
  provider: string;
  providerId?: string | null;
  todayTokens: number;
  totalTokens: number;
  todayEstimatedCost: number;
  totalEstimatedCost: number;
}

export interface DailyTokenUsage {
  date: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseNotes?: string | null;
  releaseUrl: string;
}

export const DEFAULT_CODEX_HOME_ID = "default";
export const GUI_CODEX_HOME_ID = "codex-gui";

export interface AppSettings {
  codexHome?: string | null;
  codexHomes?: CodexHomeEntry[];
  launchAtStartup?: boolean;
  closeToTray?: boolean;
  nonProxyEnhancementsEnabled?: boolean;
  floatingBubbleEnabled: boolean;
  privacyMode: boolean;
  hideAccountNotes: boolean;
  bubbleResetDisplay: BubbleResetDisplay;
  bubbleStyle: BubbleStyle;
  themeColor?: string | null;
  bubbleX?: number | null;
  bubbleY?: number | null;
  cloudBaseUrl?: string | null;
  showCustomCloudServer?: boolean;
  tokenUsageWeeks?: number;
  tokenUsageRefreshSeconds?: number;
  codexUsageSummaryEnabled?: boolean;
  autoDisableStatusCodes?: number[];
  upstream429RetryTimeoutSeconds?: number;
  sseIdleTimeout?: import("./api/sseIdleTimeout").SseIdleTimeoutSettings;
  showUsageNetworkErrors?: boolean;
  gpt56SolContextWindow?: number;
  officialModelContextWindows?: Record<string, number>;
  webProxyPort?: number | null;
  webProxyListenOnAllInterfaces?: boolean;
  networkProxy?: NetworkProxySettings;
  providerGroups?: string[];
  accountGroups?: string[];
  thirdPartyAppWrite?: ThirdPartyAppWriteSettings;
  claudeCodeWriteTarget?: ClaudeCodeWriteTarget;
}

export interface CodexHomeEntry {
  id: string;
  path: string;
  enabled: boolean;
}

export interface CodexHomePreset {
  id: string;
  name: string;
  path: string;
}

export type ClaudeCodeWriteTarget = "all" | "codex" | "claudeCode";

export type ThirdPartyAppId =
  | "claudeCode"
  | "openCode"
  | "openClaw"
  | "hermesAgent"
  | "trae"
  | "workBuddy"
  | "zCode"
  | "deepSeekHarness"
  | "openViking";

export interface ThirdPartyAppWriteSettings {
  enabled: boolean;
  writeCodex: boolean;
  apps: Record<ThirdPartyAppId, boolean>;
  claudeSubagentModel: ClaudeSubagentModel;
}

/** Model identifier used for Claude Code background agents. */
export type ClaudeSubagentModel = string;

export interface NetworkProxySettings {
  enabled: boolean;
  proxyUrl: string;
  proxyPort: number | null;
}

export interface LoginStart {
  url: string;
  embedded: boolean;
}

export interface LoginStatus {
  ok: boolean;
  message: string;
  accountId?: string | null;
}

export interface CloudAuthState {
  enabled: boolean;
  baseUrl?: string | null;
  authenticated: boolean;
  userEmail?: string | null;
  userId?: string | null;
  lastSyncAt?: string | null;
  sessionExpired: boolean;
}

export interface SavedCloudLogin {
  email: string;
  password: string;
}

export interface CloudAuthenticationResult {
  state: CloudAuthState;
  passwordSaved: boolean;
  credentialStorageUpdated: boolean;
}

export interface CloudSyncResult {
  uploaded: number;
  downloaded: number;
}

export interface CloudAnnouncement {
  /** Legacy Chinese content returned for compatibility with older clients. */
  content: string;
  contentZh: string;
  contentEn: string;
  link: string;
  enabled: boolean;
  textColor: string;
  backgroundColor: string;
  /** Older servers omit dark colors; desktop uses a readable dark palette in that case. */
  darkTextColor?: string | null;
  darkBackgroundColor?: string | null;
  scrollDurationSeconds: number;
  updatedAt?: string | null;
}

export interface CloudCurrencyRate {
  code: string;
  name: string;
  rate: number;
}

export interface CloudCurrencyRates {
  currencies: CloudCurrencyRate[];
  updatedAt: string | null;
}

export interface CloudNotification {
  id: string;
  titleZh: string;
  titleEn: string;
  contentZh: string;
  contentEn: string;
  link: string;
  linkLabelZh: string;
  linkLabelEn: string;
  enabled: boolean;
  publishedAt: string;
  updatedAt: string;
}

export interface CloudFaq {
  id: string;
  questionZh: string;
  questionEn: string;
  answerZh: string;
  answerEn: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillMarketItem {
  id: string;
  title: string;
  description: string;
  version: string;
  archiveSize: number;
  archiveSha256: string;
  hasPreview: boolean;
  uploaderId?: string | null;
  official: boolean;
  installCount: number;
  createdAt: string;
  updatedAt: string;
  installed: boolean;
  installedVersion?: string | null;
  enabled: boolean;
}

export interface OfficialPluginItem {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  category: string;
  developer: string;
  brandColor?: string | null;
  iconUrl?: string | null;
  installed: boolean;
  enabled: boolean;
}

export type PromptPluginType = "injection" | "filter";

export interface PromptPluginItem {
  id: string;
  name: string;
  version: string;
  type: PromptPluginType;
  text: string;
  uploaderId?: string | null;
  installCount: number;
  createdAt: string;
  updatedAt: string;
  installed: boolean;
  installedVersion?: string | null;
  enabled: boolean;
}

export interface PromptPluginPublishInput {
  pluginId?: string | null;
  name: string;
  version: string;
  type: PromptPluginType;
  text: string;
}

export type SkillPackageKind = "archive" | "folder";

export interface SkillPackageSelection {
  path: string;
  kind: SkillPackageKind;
  name: string;
}

export interface SkillPublishInput {
  skillId?: string | null;
  title: string;
  description: string;
  version: string;
  package: SkillPackageSelection;
  preview?: FeedbackImageInput | null;
}

export interface FeedbackImageInput {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

export interface AccountArchiveImportResult {
  imported: number;
  accountIds: string[];
  activeAccountId?: string | null;
  providersImported: number;
  providerIds: string[];
  activeProviderId?: string | null;
}

export type BubbleResetDisplay = "countdown" | "resetAt";
export type BubbleStyle = "classic" | "glass";

export interface DreamSkinThemeSummary {
  id: string;
  name: string;
}

export interface DeletedCloudAccount {
  id: string;
  email: string;
  note: string;
  expiresAt: string;
  plan: string;
  deletedAt: string;
}

export interface DeletedCloudProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  deletedAt: string;
}

export interface DreamSkinMarketTheme {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  license: string;
  sourceUrl: string;
  tags: string[];
  theme: string;
  image: string;
  preview: string;
  themeSha256: string;
  imageSha256: string;
  previewUrl: string;
  installed: boolean;
  installedVersion?: string | null;
  updateAvailable: boolean;
}

export interface DreamSkinMarketResult {
  schemaVersion: number;
  updatedAt: string;
  repositoryUrl: string;
  cached: boolean;
  warning?: string | null;
  themes: DreamSkinMarketTheme[];
}

export interface DreamSkinCommunityTheme {
  applyCompatible: boolean;
  authorDisplayName: string;
  authorUserId: string;
  displayMeta: Record<string, unknown>;
  downloadCount: number;
  id: string;
  license: string;
  name: string;
  packageBytes: number;
  packageSha256: string;
  reviewedAt: string;
  slug: string;
  submittedAt: string;
  themeId: string;
  version: string;
  previewUrl: string;
  installed: boolean;
  installedVersion?: string | null;
  updateAvailable: boolean;
}

export interface DreamSkinCommunityPage {
  items: DreamSkinCommunityTheme[];
  total: number;
  offset: number;
  limit: number;
  cached: boolean;
  warning?: string | null;
}

export type DreamSkinResourcesPhase = "idle" | "checking" | "downloading" | "ready" | "error" | "unsupported";

export interface DreamSkinResourcesStatus {
  phase: DreamSkinResourcesPhase;
  installed: boolean;
  installedVersion?: string | null;
  availableVersion?: string | null;
  downloadedBytes: number;
  totalBytes?: number | null;
  error?: string | null;
}

export type DreamSkinSession = "unsupported" | "notInstalled" | "ready" | "active" | "paused";
export type DreamSkinAppearance = "auto" | "light" | "dark";

export interface DreamSkinStatus {
  supported: boolean;
  available?: boolean;
  restartRequired?: boolean;
  platform: string;
  installed: boolean;
  runtimeInstalled: boolean;
  session: DreamSkinSession;
  activeThemeId?: string | null;
  activeThemeName?: string | null;
  activeThemeAppearance?: DreamSkinAppearance | null;
  activeThemeOverlayOpacity?: number | null;
  enginePath?: string | null;
  savedThemes: DreamSkinThemeSummary[];
}

export interface DreamSkinImportOptions {
  name: string;
  appearance: DreamSkinAppearance;
  safeArea: "auto" | "left" | "right" | "center" | "none";
  taskMode: "auto" | "ambient" | "banner" | "off";
  focusX?: number | null;
  focusY?: number | null;
}
