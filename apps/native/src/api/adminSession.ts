import { t } from '../i18n';
import type { AuthResponse, AuthSession } from '../types';
import {
  fetchBufferedResponse, SESSION_REFRESH_TIMEOUT_MS, throwIfAborted, waitWithSignal, withRequestDeadline,
  type DeadlineRequestInit,
} from '../../../../shared/http/requestDeadline';
import {
  activateSession, assertCurrentSession, assertSessionEpoch, beginLogin, clearSession, persistSession, sessionEpoch,
} from './sessionStore';
import { ApiError, isSessionExpiredError, parseError, SessionExpiredError } from './responseError';

function normalizeBaseUrl(value: string) {
  const baseUrl = value.trim().replace(/\/+$/, '');
  let url: URL;
  try { url = new URL(baseUrl); } catch {
    throw new ApiError(t('client.mobile.enterAValidServerUrlSuchAsHttpsApiExample'));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError(t('client.mobile.theServerUrlMustStartWithHttpOrHttps'));
  }
  return baseUrl;
}

const deadlineOptions = (init: DeadlineRequestInit = {}) => ({
  signal: init.signal, timeoutMs: init.timeoutMs,
  timeoutMessage: t('client.projectBrowser.theRequestTimedOutPleaseTryAgain'),
});

async function requestResponse(input: string, init: RequestInit) {
  try {
    return await fetchBufferedResponse(input, init);
  } catch (error) {
    throwIfAborted(init.signal);
    if (error instanceof ApiError) throw error;
    throw new ApiError(t('client.mobile.cannotConnectToTheServerCheckYourConnection'));
  }
}

export async function login(
  baseUrlInput: string, email: string, password: string,
  options: Pick<DeadlineRequestInit, 'signal' | 'timeoutMs'> = {},
): Promise<AuthSession> {
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  throwIfAborted(options.signal);
  if (!email.trim() || !password) throw new ApiError(t('client.app.enterYourEmailAndPassword'));
  const epoch = beginLogin();
  const response = await withRequestDeadline(deadlineOptions(options), signal => requestResponse(`${baseUrl}/auth/login`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  }));
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  const payload = await response.json() as AuthResponse;
  throwIfAborted(options.signal);
  if (!payload.accessToken || !payload.refreshToken) throw new ApiError(t('client.app.theServerReturnedInvalidSignInDetails'));
  const session: AuthSession = {
    baseUrl, accessToken: payload.accessToken, refreshToken: payload.refreshToken,
    email: payload.user?.email ?? email.trim(), profile: payload.user,
  };
  await activateSession(session, epoch);
  return session;
}

const refreshRequests = new WeakMap<AuthSession, Promise<AuthSession>>();

async function performSessionRefresh(session: AuthSession): Promise<AuthSession> {
  const epoch = sessionEpoch();
  return withRequestDeadline(deadlineOptions({ timeoutMs: SESSION_REFRESH_TIMEOUT_MS }), async signal => {
    const response = await requestResponse(`${session.baseUrl}/auth/refresh`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    assertSessionEpoch(epoch);
    assertCurrentSession(session);
    if (response.status === 401 || response.status === 403) throw new SessionExpiredError(response.status);
    if (!response.ok) throw new ApiError(await parseError(response), response.status);
    const payload = await response.json() as AuthResponse;
    throwIfAborted(signal);
    assertSessionEpoch(epoch);
    if (!payload.accessToken || !payload.refreshToken) {
      throw new ApiError(t('client.app.theServerReturnedInvalidSignInDetails'));
    }
    // Keep the object used by native screens/chats in sync with rotated credentials.
    Object.assign(session, { accessToken: payload.accessToken, refreshToken: payload.refreshToken });
    await persistSession(session);
    return session;
  });
}

export async function refreshSession(session: AuthSession, options: Pick<RequestInit, 'signal'> = {}) {
  throwIfAborted(options.signal);
  assertCurrentSession(session);
  let pending = refreshRequests.get(session);
  if (!pending) {
    pending = performSessionRefresh(session).finally(() => refreshRequests.delete(session));
    refreshRequests.set(session, pending);
  }
  return waitWithSignal(pending, options.signal);
}

export async function authorizedRequest(
  session: AuthSession, path: string, init: DeadlineRequestInit = {},
): Promise<Response> {
  assertCurrentSession(session);
  const epoch = sessionEpoch();
  return withRequestDeadline(deadlineOptions(init), async signal => {
    const request = async (accessToken: string) => {
      throwIfAborted(signal);
      assertSessionEpoch(epoch);
      assertCurrentSession(session);
      const { timeoutMs: _timeoutMs, ...requestInit } = init;
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      const response = await requestResponse(`${session.baseUrl}${path}`, { ...requestInit, headers, signal });
      assertSessionEpoch(epoch);
      return response;
    };
    const accessToken = session.accessToken;
    const response = await request(accessToken);
    if (response.status !== 401) return response;
    try {
      if (session.accessToken === accessToken) await refreshSession(session, { signal });
      const retryToken = session.accessToken;
      const retry = await request(retryToken);
      if (retry.status === 401) {
        if (session.accessToken !== retryToken) throw new ApiError(t('client.app.couldNotRefreshYourSession'));
        throw new SessionExpiredError(retry.status);
      }
      return retry;
    } catch (error) {
      assertSessionEpoch(epoch);
      if (isSessionExpiredError(error)) {
        await clearSession();
        assertSessionEpoch(epoch + 1);
      }
      throw error;
    }
  });
}
