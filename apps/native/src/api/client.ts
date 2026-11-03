import { t } from '../i18n';
import { authorizedRequest } from './adminSession';
import { persistSession } from './sessionStore';
import { ApiError, parseError } from './responseError';
import type { DeadlineRequestInit } from '../../../../shared/http/requestDeadline';
export { authorizedRequest, login, refreshSession } from './adminSession';
export { clearSession, loadSession } from './sessionStore';
export { ApiError, SessionExpiredError, isSessionExpiredError } from './responseError';
import * as SecureStore from 'expo-secure-store';
import { remoteModelPath, remoteProviderCommand, type RemoteModelTarget } from '../../../../shared/remote-chat/modelTarget';
import type {
  AccountDetailsDraft,
  AccountOAuthPoll,
  AccountOAuthStart,
  AccountSummary,
  AuthSession,
  EmbeddedAccountOAuthCallback,
  EmbeddedAccountOAuthStart,
  RemoteDevice,
  RemoteModelSwitchResult,
  RemoteProviderSummary,
  ResetCreditsSummary,
  UsageSummary,
  UsageWindow,
  UserProfile,
} from '../types';
import type { TotpVault } from '../totp/types';
import { normalizeTotpVault } from '../totp/vault';

const GLOBAL_REFRESH_INTERVAL_KEY = 'codex-switch.mobile.global-refresh-minutes.v1';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CODEX_RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const CODEX_RESET_CREDIT_CONSUME_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume';
const CODEX_ORIGINATOR = 'codex_cli_rs';
export const DEFAULT_GLOBAL_REFRESH_MINUTES = 30;
export const DEFAULT_CLOUD_BASE_URL = 'https://codex.onepiper.cloud';

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function accountPrivateDetails(value: unknown) {
  const details = objectValue(value);
  return {
    password: typeof details?.password === 'string' ? details.password : '',
    phoneNumber: typeof details?.phoneNumber === 'string' ? details.phoneNumber : '',
    totpSecret: typeof details?.totpSecret === 'string' ? details.totpSecret : '',
  };
}

function upstreamErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : t("client.mobile.couldNotQueryCodex");
}

async function codexResponseObject(response: Response, context: string) {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(t("client.mobile.theResponseIsNotValidJson", { value1: context }));
  }
  const body = objectValue(payload);
  if (!body) throw new ApiError(t("client.mobile.invalidResponseFormat", { value1: context }));
  return body;
}

async function parseCodexError(response: Response) {
  if (response.status === 401 || response.status === 403) {
    return t("client.mobile.codexCredentialsExpiredRefreshAndSyncThisAccountOnYour");
  }
  try {
    const payload: unknown = await response.json();
    const body = objectValue(payload);
    for (const key of ['message', 'detail', 'error'] as const) {
      const value = body?.[key];
      if (typeof value === 'string' && value.trim()) return value;
      const nested = objectValue(value);
      if (typeof nested?.message === 'string' && nested.message.trim()) {
        return nested.message;
      }
    }
  } catch {
    // Fall through to the generic upstream status message.
  }
  return t("client.mobile.codexRequestFailedHttp", { value1: response.status });
}

export async function requestCodexDirect(
  account: AccountSummary,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = account.codexAccessToken?.trim();
  if (!accessToken) {
    throw new ApiError(t("client.mobile.thisAccountHasNoCodexTokenForADirectPhone"));
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('originator', CODEX_ORIGINATOR);
  headers.set('User-Agent', 'codex_cli_rs/0.1.0');
  if (account.accountId) headers.set('ChatGPT-Account-Id', account.accountId);

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    if (init.signal?.aborted) throw new ApiError(t("client.mobile.codexRequestTimedOutTryAgainLater"));
    throw new ApiError(t("client.mobile.cannotConnectToCodexFromYourPhoneCheckYourNetwork"));
  }
  if (!response.ok) {
    throw new ApiError(await parseCodexError(response), response.status);
  }
  return response;
}

function usageWindow(value: unknown): UsageWindow | null {
  const window = objectValue(value);
  const usedPercent = numberValue(window?.used_percent);
  if (usedPercent === undefined) return null;
  const used = Math.max(0, Math.min(100, usedPercent));
  const resetAt = numberValue(window?.reset_at);
  const windowSeconds = numberValue(window?.limit_window_seconds);
  return {
    usedPercent: used,
    remainingPercent: Math.max(0, Math.min(100, 100 - used)),
    resetsAt: resetAt ?? null,
    windowMinutes: windowSeconds && windowSeconds > 0
      ? Math.floor(windowSeconds / 60)
      : null,
  };
}

export async function fetchAccountUsage(account: AccountSummary): Promise<UsageSummary> {
  const response = await requestCodexDirect(account, CODEX_USAGE_URL);
  const body = await codexResponseObject(response, t("client.mobile.couldNotReadCodexUsage"));
  const rateLimit = objectValue(body.rate_limit);
  const plan = typeof body.plan_type === 'string' && body.plan_type.trim()
    ? body.plan_type.trim()
    : null;
  return {
    primary: usageWindow(rateLimit?.primary_window),
    secondary: usageWindow(rateLimit?.secondary_window),
    apiExpiresAt: promoExpiration(body.promo),
    plan,
    fetchedAt: new Date().toISOString(),
    error: null,
  };
}

function normalizedTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const numeric = numberValue(value);
  if (numeric === undefined) return null;
  const milliseconds = Math.abs(numeric) >= 100_000_000_000 ? numeric : numeric * 1000;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isExpirationKey(key: string) {
  const normalized = key.toLowerCase().replace(/-/g, '_');
  const compact = normalized.replace(/_/g, '');
  return normalized.includes('expir')
    || compact.endsWith('until')
    || compact.endsWith('end')
    || compact.endsWith('endat')
    || compact.endsWith('endsat')
    || compact.endsWith('enddate')
    || compact.endsWith('endson');
}

function collectExpirationTimestamps(value: unknown, result: string[]) {
  if (Array.isArray(value)) {
    value.forEach((nested) => collectExpirationTimestamps(nested, result));
    return;
  }
  const object = objectValue(value);
  if (!object) return;
  for (const [key, nested] of Object.entries(object)) {
    if (isExpirationKey(key)) {
      const timestamp = normalizedTimestamp(nested);
      if (timestamp) result.push(timestamp);
    }
    collectExpirationTimestamps(nested, result);
  }
}

function promoExpiration(value: unknown) {
  if (value == null) return null;
  const timestamps: string[] = [];
  collectExpirationTimestamps(value, timestamps);
  timestamps.sort((left, right) => Date.parse(left) - Date.parse(right));
  return timestamps[0] ?? null;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(values[index] as T, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function loadGlobalRefreshMinutes(): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(GLOBAL_REFRESH_INTERVAL_KEY);
    if (!raw) return DEFAULT_GLOBAL_REFRESH_MINUTES;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 1 && value <= 1440
      ? value
      : DEFAULT_GLOBAL_REFRESH_MINUTES;
  } catch {
    return DEFAULT_GLOBAL_REFRESH_MINUTES;
  }
}

export async function saveGlobalRefreshMinutes(value: number): Promise<void> {
  if (!Number.isInteger(value) || value < 1 || value > 1440) {
    throw new ApiError(t("client.mobile.setTheRefreshIntervalTo11440Minutes"));
  }
  await SecureStore.setItemAsync(GLOBAL_REFRESH_INTERVAL_KEY, String(value));
}

export async function adminRequest<T>(session: AuthSession, path: string, init: DeadlineRequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await authorizedRequest(session, path, { ...init, headers });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function fetchAccountSummary(session: AuthSession): Promise<AccountSummary[]> {
  const response = await authorizedRequest(session, '/sync/accounts/summary');
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { accounts?: unknown }).accounts)) {
    throw new ApiError(t("client.mobile.theServerReturnedInvalidAccountData"));
  }
  return (payload as { accounts: AccountSummary[] }).accounts.map((account) => ({
    ...account,
    privateDetails: accountPrivateDetails(account.privateDetails),
  }));
}

export async function fetchAccountUsageSummaries(
  accounts: readonly AccountSummary[],
): Promise<AccountSummary[]> {
  return mapWithConcurrency(accounts, 4, async (account) => {
    try {
      const usage = await fetchAccountUsage(account);
      return { ...account, plan: usage.plan ?? account.plan, usage };
    } catch (error) {
      return {
        ...account,
        usage: {
          primary: null,
          secondary: null,
          fetchedAt: new Date().toISOString(),
          error: upstreamErrorMessage(error),
        },
      };
    }
  });
}

export async function fetchResetCredits(account: AccountSummary): Promise<ResetCreditsSummary> {
  const response = await requestCodexDirect(account, CODEX_RESET_CREDITS_URL);
  const body = await codexResponseObject(response, t("client.mobile.couldNotReadCodexResetCredits"));
  if (!Array.isArray(body?.credits)) {
    throw new ApiError(t("client.mobile.codexReturnedInvalidResetCreditData"));
  }
  const credits = body.credits.map((value) => {
    const credit = objectValue(value);
    return {
      issuedAt: normalizedTimestamp(credit?.granted_at ?? credit?.created_at),
      expiresAt: normalizedTimestamp(credit?.expires_at),
    };
  });
  credits.sort((left, right) => (left.expiresAt ?? '').localeCompare(right.expiresAt ?? ''));
  return { credits };
}

export async function consumeResetCredit(account: AccountSummary): Promise<void> {
  const current = await fetchResetCredits(account);
  if (!current.credits.length) throw new ApiError(t("client.mobile.thisAccountHasNoResetCredits"));

  const response = await requestCodexDirect(account, CODEX_RESET_CREDIT_CONSUME_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redeem_request_id: `codex-switch-mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
  });
  const code = (await codexResponseObject(response, t("client.mobile.couldNotReadTheCodexResetResult"))).code;
  if (code === 'reset' || code === 'already_redeemed') return;
  if (code === 'no_credit') throw new ApiError(t("client.mobile.thisAccountHasNoResetCredits"));
  if (code === 'nothing_to_reset') {
    throw new ApiError(t("client.mobile.thisAccountHasNoUsageWindowsToReset"));
  }
  if (typeof code === 'string') throw new ApiError(t("client.mobile.unknownResetStatusFromCodex", { value1: code }));
  throw new ApiError(t("client.mobile.codexDidNotReturnAResetStatus"));
}

export async function fetchRemoteDevices(session: AuthSession): Promise<RemoteDevice[]> {
  const response = await authorizedRequest(session, '/devices');
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { devices?: unknown }).devices)) {
    throw new ApiError(t("client.mobile.theServerReturnedInvalidDeviceData"));
  }
  return (payload as { devices: RemoteDevice[] }).devices.map((device) => ({
    ...device,
    activeProviderId: device.activeProviderId ?? null,
    activeProviderGroup: device.activeProviderGroup ?? null,
    localProxyRunning: device.localProxyRunning === true,
    capabilities: Array.isArray(device.capabilities) ? device.capabilities : [],
  }));
}

export async function fetchRemoteProviders(
  session: AuthSession,
): Promise<RemoteProviderSummary[]> {
  const response = await authorizedRequest(session, '/devices/providers?includeAggregates=true');
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { providers?: unknown }).providers)) {
    throw new ApiError(t("client.mobile.theServerReturnedInvalidProviderData"));
  }
  return (payload as { providers: RemoteProviderSummary[] }).providers.map((provider) => ({
    ...provider,
    group: typeof provider.group === 'string' ? provider.group : '',
  }));
}

export async function revokeDesktopService(session: AuthSession, deviceId: string): Promise<void> {
  const response = await authorizedRequest(session, `/devices/${encodeURIComponent(deviceId)}/service-credential`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
}

export async function deleteRemoteDevice(session: AuthSession, deviceId: string): Promise<void> {
  const response = await authorizedRequest(session, `/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
}

export async function switchRemoteDeviceAccount(
  session: AuthSession,
  deviceId: string,
  accountId: string,
  target: RemoteModelTarget = 'proxy',
): Promise<RemoteModelSwitchResult> {
  const path = `/devices/${encodeURIComponent(deviceId)}/${remoteModelPath('account', target)}`;
  const response = await authorizedRequest(session, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<RemoteModelSwitchResult>;
}

export async function switchRemoteDeviceProvider(
  session: AuthSession,
  deviceId: string,
  providerId: string,
  target: RemoteModelTarget = 'proxy',
): Promise<RemoteModelSwitchResult> {
  const command = remoteProviderCommand(providerId, target);
  const path = `/devices/${encodeURIComponent(deviceId)}/${command.path}`;
  const response = await authorizedRequest(session, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command.body),
  });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<RemoteModelSwitchResult>;
}

export async function switchRemoteDeviceProviderGroup(
  session: AuthSession,
  deviceId: string,
  group: string,
): Promise<RemoteModelSwitchResult> {
  const response = await authorizedRequest(
    session,
    `/devices/${encodeURIComponent(deviceId)}/provider-group`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group }),
    },
  );
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<RemoteModelSwitchResult>;
}

export async function restartRemoteDeviceCodex(
  session: AuthSession,
  deviceId: string,
): Promise<void> {
  const response = await authorizedRequest(
    session,
    `/devices/${encodeURIComponent(deviceId)}/restart-codex`,
    { method: 'POST' },
  );
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
}

export async function setRemoteDeviceOpenAiAuthAccount(
  session: AuthSession,
  deviceId: string,
  accountId: string,
): Promise<{ deviceId: string; openaiAuthAccountId: string; online: boolean }> {
  const response = await authorizedRequest(
    session,
    `/devices/${encodeURIComponent(deviceId)}/openai-auth-account`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    },
  );
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<{
    deviceId: string;
    openaiAuthAccountId: string;
    online: boolean;
  }>;
}

export async function fetchUserProfile(session: AuthSession): Promise<UserProfile> {
  const response = await authorizedRequest(session, '/auth/me');
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(t("client.mobile.theServerReturnedInvalidUserDetails"));
  }
  const profile = payload as Partial<UserProfile>;
  if (!profile.id || !profile.email || !profile.role) {
    throw new ApiError(t("client.mobile.theServerReturnedInvalidUserDetails"));
  }
  const nextProfile = profile as UserProfile;
  session.email = nextProfile.email;
  session.profile = nextProfile;
  await persistSession(session);
  return nextProfile;
}

export async function changePassword(session: AuthSession, currentPassword: string, newPassword: string): Promise<void> {
  const response = await authorizedRequest(session, '/admin/api/profile/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
}

export async function importPersonalAccounts(
  session: AuthSession,
  content: string,
  options: { note?: string; expiresAt?: string } = {},
): Promise<{ accounts: AccountSummary[]; importedCount: number; skippedCount: number; skipped: string[] }> {
  const response = await authorizedRequest(session, '/sync/accounts/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, ...options }),
  });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<{
    accounts: AccountSummary[];
    importedCount: number;
    skippedCount: number;
    skipped: string[];
  }>;
}
export async function startAccountOAuth(session: AuthSession): Promise<AccountOAuthStart> {
  const response = await authorizedRequest(session, '/sync/accounts/oauth/start', { method: 'POST' });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<AccountOAuthStart>;
}

export async function pollAccountOAuth(
  session: AuthSession,
  sessionId: string,
): Promise<AccountOAuthPoll> {
  const response = await authorizedRequest(
    session,
    `/sync/accounts/oauth/${encodeURIComponent(sessionId)}/poll`,
    { method: 'POST' },
  );
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<AccountOAuthPoll>;
}

export async function startEmbeddedAccountOAuth(
  session: AuthSession,
): Promise<EmbeddedAccountOAuthStart> {
  const response = await authorizedRequest(
    session,
    '/sync/accounts/oauth/embedded/start',
    { method: 'POST' },
  );
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<EmbeddedAccountOAuthStart>;
}

export async function completeEmbeddedAccountOAuth(
  session: AuthSession,
  sessionId: string,
  callback: EmbeddedAccountOAuthCallback,
): Promise<AccountOAuthPoll> {
  const response = await authorizedRequest(
    session,
    `/sync/accounts/oauth/embedded/${encodeURIComponent(sessionId)}/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(callback),
    },
  );
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<AccountOAuthPoll>;
}

export async function pollEmbeddedAccountOAuth(
  session: AuthSession,
  sessionId: string,
): Promise<AccountOAuthPoll> {
  const response = await authorizedRequest(
    session,
    `/sync/accounts/oauth/embedded/${encodeURIComponent(sessionId)}/poll`,
    { method: 'POST' },
  );
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.json() as Promise<AccountOAuthPoll>;
}

export async function updateAccountDetails(
  session: AuthSession,
  accountId: string,
  details: AccountDetailsDraft,
): Promise<AccountSummary> {
  const response = await authorizedRequest(
    session,
    `/sync/accounts/${encodeURIComponent(accountId)}/details`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(details),
    },
  );
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const account = await response.json() as AccountSummary;
  return { ...account, privateDetails: accountPrivateDetails(account.privateDetails) };
}

export async function syncTotpVault(session: AuthSession, vault: TotpVault): Promise<TotpVault> {
  const response = await authorizedRequest(session, '/sync/totp', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(vault),
  });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') throw new ApiError(t("client.mobile.theServerReturnedInvalid2faData"));
  const normalized = normalizeTotpVault(payload);
  if (!normalized) throw new ApiError(t("client.mobile.theServerReturnedInvalid2faData"));
  return normalized;
}

export async function fetchTotpVault(session: AuthSession): Promise<TotpVault | null> {
  const response = await authorizedRequest(session, '/sync/totp');
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') throw new ApiError(t("client.mobile.theServerReturnedInvalid2faData"));
  const candidate = payload as Partial<TotpVault> & { modifiedAt?: string | null };
  if (candidate.modifiedAt === null) return null;
  const vault = normalizeTotpVault(payload);
  if (!vault) throw new ApiError(t("client.mobile.theServerReturnedInvalid2faData"));
  return vault;
}
