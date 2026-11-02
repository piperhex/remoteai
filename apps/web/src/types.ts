export interface UsageWindow {
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: number | null;
  windowMinutes?: number | null;
}

export interface UsageSummary {
  primary?: UsageWindow | null;
  secondary?: UsageWindow | null;
  apiExpiresAt?: string | null;
  plan?: string | null;
  fetchedAt?: string | null;
  error?: string | null;
}

export interface AccountPrivateDetails {
  alias?: string;
  password: string;
  phoneNumber: string;
  totpSecret: string;
}

export interface AccountSummary {
  id: string;
  email: string;
  note: string;
  expiresAt: string;
  plan: string;
  accountId?: string | null;
  active: boolean;
  usage: UsageSummary;
  privateDetails?: AccountPrivateDetails;
  lastModifiedAt?: string;
  source?: "personal" | "system";
}

export type RemoteControlCapability =
  | 'provider-switch' | 'provider-group-switch' | 'restart-codex' | 'gui-model-switch'
  | 'aggregate-switch' | 'gui-aggregate-switch' | 'account-usage' | 'screen-power';

export interface RemoteDevice {
  guiAccountId?: string | null;
  guiProviderId?: string | null;
  deviceId: string;
  name: string;
  platform: string;
  appVersion?: string | null;
  activeAccountId?: string | null;
  openaiAuthAccountId?: string | null;
  activeProviderId?: string | null;
  activeProviderGroup?: string | null;
  localProxyRunning: boolean;
  capabilities: RemoteControlCapability[];
  lastSeenAt: string;
  online: boolean;
}

export interface RemoteProviderSummary {
  id: string;
  name: string;
  model: string;
  group: string;
}

export interface RemoteModelSwitchResult {
  guiAccountId?: string | null;
  guiProviderId?: string | null;
  deviceId: string;
  activeAccountId?: string | null;
  activeProviderId?: string | null;
  activeProviderGroup?: string | null;
  requiresRestart: boolean;
  online: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  role: string;
  roleName?: string;
  permissions?: string[];
}

export interface AuthSession {
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  profile?: UserProfile;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user?: UserProfile;
}

export interface ResetCredit {
  issuedAt?: string | null;
  expiresAt?: string | null;
}

export interface ResetCreditsSummary {
  credits: ResetCredit[];
}

export type AppPage = "chat" | "accounts" | "discover" | "devices" | "totp" | "downloads" | "lounge"
  | "token-summary" | "settings" | "ssh";
export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface TotpEntry {
  id: string;
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
  createdAt: string;
  updatedAt: string;
}

export interface TotpTombstone {
  id: string;
  deletedAt: string;
}

export interface TotpVault {
  entries: TotpEntry[];
  tombstones: TotpTombstone[];
  modifiedAt: string;
}
export interface AccountImportResult {
  accounts: AccountSummary[];
  importedCount: number;
  skippedCount: number;
  skipped: string[];
}

export type DeviceStatusSocketMessage =
  | { type: "devices-snapshot"; devices: RemoteDevice[] }
  | { type: "device-online"; device: RemoteDevice }
  | { type: "device-offline"; deviceId: string; lastSeenAt: string }
  | { type: "device-removed"; deviceId: string };
