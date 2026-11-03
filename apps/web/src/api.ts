import { remoteProviderCommand, type RemoteModelTarget } from '../../../shared/remote-chat/modelTarget';
import { t } from './i18n';
import {
  fetchBufferedResponse, SESSION_REFRESH_TIMEOUT_MS, throwIfAborted, waitWithSignal, withRequestDeadline,
  type DeadlineRequestInit,
} from '../../../shared/http/requestDeadline';
import type {
  AccountSummary,
  AuthResponse,
  AccountImportResult,
  AuthSession,
  DeviceStatusSocketMessage,
  RemoteDevice,
  RemoteModelSwitchResult,
  RemoteProviderSummary,
  ResetCreditsSummary,
  TotpVault,
  UserProfile,
} from "./types";

const SESSION_KEY = "codex-switch.web.session.v1";
const API_BASE_FROM_ENV = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

let activeSession: AuthSession | null = null;
let sessionEpoch = 0;
const refreshRequests = new WeakMap<AuthSession, Promise<AuthSession>>();
const sessionListeners = new Set<(session: AuthSession | null) => void>();

export function defaultApiBaseUrl() {
  return normalizeBaseUrl(API_BASE_FROM_ENV || window.location.origin);
}

export function normalizeBaseUrl(value: string) {
  const raw = value.trim() || window.location.origin;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("请输入有效的服务地址，例如 https://api.example.com");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("服务地址仅支持 HTTP 或 HTTPS");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function loadStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (!parsed.baseUrl || !parsed.accessToken || !parsed.refreshToken || !parsed.email) return null;
    sessionEpoch += 1;
    activeSession = parsed as AuthSession;
    return activeSession;
  } catch {
    return null;
  }
}

export function getActiveSession() {
  return activeSession;
}

export function setActiveSession(session: AuthSession | null) {
  sessionEpoch += 1;
  publishSession(session);
}

function publishSession(session: AuthSession | null) {
  activeSession = session;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  sessionListeners.forEach((listener) => listener(session));
}

export function subscribeSession(listener: (session: AuthSession | null) => void) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

async function responseError(response: Response) {
  const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
  if (Array.isArray(payload?.message)) return payload.message.join("；");
  return payload?.message || t("client.app.requestFailedHttp", { value1: response.status });
}

function assertSessionEpoch(epoch: number) {
  if (sessionEpoch !== epoch) throw new Error(t('client.app.pleaseSignInFirst'));
}

const deadlineOptions = (init: DeadlineRequestInit = {}) => ({
  signal: init.signal, timeoutMs: init.timeoutMs,
  timeoutMessage: t('client.projectBrowser.theRequestTimedOutPleaseTryAgain'),
});

async function performSessionRefresh(session: AuthSession, epoch: number) {
  return withRequestDeadline(deadlineOptions({ timeoutMs: SESSION_REFRESH_TIMEOUT_MS }), async signal => {
    const response = await fetchBufferedResponse(`${session.baseUrl}/auth/refresh`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    assertSessionEpoch(epoch);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        setActiveSession(null);
        throw Object.assign(new Error(t('client.app.yourSessionHasExpiredPleaseSignInAgain')),
          { status: response.status });
      }
      throw Object.assign(new Error(t('client.app.couldNotRefreshYourSession')), { status: response.status });
    }
    const payload = await response.json() as AuthResponse;
    throwIfAborted(signal);
    assertSessionEpoch(epoch);
    if (!payload.accessToken || !payload.refreshToken) throw new Error(t('client.app.couldNotRefreshYourSession'));
    const next = { ...session, accessToken: payload.accessToken, refreshToken: payload.refreshToken };
    publishSession(next);
    return next;
  });
}

export async function refreshSession(options: Pick<RequestInit, 'signal'> = {}) {
  throwIfAborted(options.signal);
  const session = activeSession;
  if (!session?.refreshToken) throw new Error(t('client.app.yourSessionHasExpiredPleaseSignInAgain'));
  let pending = refreshRequests.get(session);
  if (!pending) {
    pending = performSessionRefresh(session, sessionEpoch).finally(() => refreshRequests.delete(session));
    refreshRequests.set(session, pending);
  }
  return waitWithSignal(pending, options.signal);
}

export async function authorizedFetch(
  path: string, init: DeadlineRequestInit = {}, guard?: (session: AuthSession | null) => void,
) {
  const session = activeSession;
  const epoch = sessionEpoch;
  if (!session) throw new Error(t('client.app.pleaseSignInFirst'));
  return withRequestDeadline(deadlineOptions(init), async signal => {
    const request = async (current: AuthSession) => {
      throwIfAborted(signal);
      assertSessionEpoch(epoch);
      guard?.(current);
      const { timeoutMs: _timeoutMs, ...requestInit } = init;
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${current.accessToken}`);
      if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      const response = await fetchBufferedResponse(`${current.baseUrl}${path}`, { ...requestInit, headers, signal });
      guard?.(activeSession);
      assertSessionEpoch(epoch);
      return response;
    };
    const response = await request(session);
    if (response.status !== 401) return response;
    // A late 401 for the previous token must reuse an already completed rotation.
    const refreshed = activeSession !== session ? activeSession! : await refreshSession({ signal });
    const retry = await request(refreshed);
    if (retry.status === 401) {
      if (activeSession !== refreshed) throw new Error(t('client.app.couldNotRefreshYourSession'));
      setActiveSession(null);
      throw new Error(t('client.app.yourSessionHasExpiredPleaseSignInAgain'));
    }
    return retry;
  });
}

export async function apiJson<T>(path: string, init: DeadlineRequestInit = {}): Promise<T> {
  const response = await authorizedFetch(path, init);
  if (!response.ok) throw new Error(await responseError(response));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function login(
  baseUrl: string, email: string, password: string,
  options: Pick<DeadlineRequestInit, 'signal' | 'timeoutMs'> = {},
) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  throwIfAborted(options.signal);
  const epoch = ++sessionEpoch;
  const response = await withRequestDeadline(deadlineOptions(options), signal => fetchBufferedResponse(
    `${normalizedBaseUrl}/auth/login`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    }));
  if (!response.ok) throw new Error(await responseError(response));
  const payload = await response.json() as AuthResponse;
  throwIfAborted(options.signal);
  assertSessionEpoch(epoch);
  if (!payload.accessToken || !payload.refreshToken) throw new Error("服务器返回的登录信息无效");
  const session: AuthSession = {
    baseUrl: normalizedBaseUrl,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    email: payload.user?.email ?? email.trim(),
    profile: payload.user,
  };
  setActiveSession(session);
  return session;
}

export async function logout(options: Pick<DeadlineRequestInit, 'signal' | 'timeoutMs'> = {}) {
  const session = activeSession;
  setActiveSession(null);
  if (session?.refreshToken) {
    await withRequestDeadline(deadlineOptions(options), signal => fetchBufferedResponse(`${session.baseUrl}/auth/logout`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    })).catch(() => undefined);
  }
}

export async function fetchDashboardData() {
  const [{ accounts }, devicesPayload, { providers }, profile] = await Promise.all([
    apiJson<{ accounts: AccountSummary[] }>("/sync/accounts/web-summary"),
    apiJson<{ devices: RemoteDevice[] }>("/devices"),
    apiJson<{ providers: RemoteProviderSummary[] }>("/devices/providers?includeAggregates=true"),
    apiJson<UserProfile>("/auth/me"),
  ]);
  const devices = devicesPayload.devices.map(normalizeRemoteDevice);
  const normalizedProviders = providers.map((provider) => ({
    ...provider,
    group: typeof provider.group === "string" ? provider.group : "",
  }));
  return { accounts, devices, providers: normalizedProviders, profile };
}

export function deviceStatusWebSocketUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/device-switch`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function parseDeviceStatusMessage(value: unknown): DeviceStatusSocketMessage | null {
  if (typeof value !== "string") return null;
  try {
    const message = JSON.parse(value) as DeviceStatusSocketMessage;
    if (message.type === "devices-snapshot" && Array.isArray(message.devices)) {
      return { ...message, devices: message.devices.map(normalizeRemoteDevice) };
    }
    if (message.type === "device-online" && message.device?.deviceId) {
      return { ...message, device: normalizeRemoteDevice(message.device) };
    }
    if (message.type === "device-offline" && message.deviceId) return message;
    if (message.type === "device-removed" && message.deviceId) return message;
  } catch {
    return null;
  }
  return null;
}

export async function startAccountOAuth() {
  return apiJson<{ sessionId: string; verificationUrl: string; userCode: string; interval: number; expiresIn: number }>(
    '/sync/accounts/oauth/start',
    { method: 'POST' },
  );
}

export async function pollAccountOAuth(sessionId: string) {
  return apiJson<{ status: 'pending' | 'complete' | 'failed'; message?: string; account?: AccountSummary }>(
    `/sync/accounts/oauth/${encodeURIComponent(sessionId)}/poll`,
    { method: 'POST' },
  );
}

export async function importPersonalAccounts(content: string, options: { note?: string; expiresAt?: string } = {}) {
  return apiJson<AccountImportResult>('/sync/accounts/import', {
    method: 'POST',
    body: JSON.stringify({ content, ...options }),
  });
}
export async function fetchAccountDetails(accountId: string) {
  return apiJson<AccountSummary>(`/sync/accounts/${encodeURIComponent(accountId)}/details`);
}

export async function updateAccountDetails(accountId: string, details: {
  note: string;
  expiresAt: string;
  privateDetails: { alias?: string; password: string; phoneNumber: string; totpSecret: string };
}) {
  return apiJson<AccountSummary>(`/sync/accounts/${encodeURIComponent(accountId)}/details`, {
    method: 'PATCH',
    body: JSON.stringify(details),
  });
}
export async function fetchTotpVault() {
  return apiJson<TotpVault & { modifiedAt: string | null }>('/sync/totp');
}

export async function putTotpVault(vault: TotpVault) {
  return apiJson<TotpVault>('/sync/totp', {
    method: 'PUT',
    body: JSON.stringify(vault),
  });
}
export async function fetchResetCredits(accountId: string) {
  return apiJson<ResetCreditsSummary>(`/sync/accounts/${encodeURIComponent(accountId)}/reset-credits`);
}

export async function consumeResetCredit(accountId: string) {
  return apiJson<{ ok: true }>(`/sync/accounts/${encodeURIComponent(accountId)}/reset-credits/consume`, {
    method: "POST",
  });
}

export async function switchRemoteDeviceProvider(
  deviceId: string, providerId: string, target: RemoteModelTarget = 'proxy',
) {
  const command = remoteProviderCommand(providerId, target);
  return apiJson<RemoteModelSwitchResult>(
    `/devices/${encodeURIComponent(deviceId)}/${command.path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command.body),
    },
  );
}

export async function switchRemoteDeviceProviderGroup(deviceId: string, group: string) {
  return apiJson<RemoteModelSwitchResult>(
    `/devices/${encodeURIComponent(deviceId)}/provider-group`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group }),
    },
  );
}

export async function restartRemoteDeviceCodex(deviceId: string) {
  await apiJson<{ deviceId: string; restarted: boolean }>(
    `/devices/${encodeURIComponent(deviceId)}/restart-codex`,
    { method: "POST" },
  );
}

function normalizeRemoteDevice(device: RemoteDevice): RemoteDevice {
  return {
    ...device,
    activeProviderId: device.activeProviderId ?? null,
    activeProviderGroup: device.activeProviderGroup ?? null,
    localProxyRunning: device.localProxyRunning === true,
    capabilities: Array.isArray(device.capabilities)
      ? device.capabilities.filter((capability) => (
        capability === "provider-switch"
        || capability === "provider-group-switch"
        || capability === "restart-codex"
        || capability === "gui-model-switch"
        || capability === "aggregate-switch"
        || capability === "gui-aggregate-switch"
        || capability === "account-usage"
      ))
      : [],
  };
}
