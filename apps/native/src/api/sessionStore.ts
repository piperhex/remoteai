import * as SecureStore from 'expo-secure-store';
import { t } from '../i18n';
import type { AuthSession } from '../types';

const SESSION_KEY = 'codex-switch.mobile.session.v1';
let currentSession: AuthSession | null | undefined;
let epoch = 0;
let storageWrites = Promise.resolve();

function queueWrite(write: () => Promise<void>) {
  const pending = storageWrites.then(write);
  // A failed write is reported to its caller and must not block subsequent logins/logout.
  storageWrites = pending.catch(() => undefined);
  return pending;
}

export function sessionEpoch() { return epoch; }

export function assertSessionEpoch(expected: number) {
  if (expected !== epoch) throw new Error(t('client.app.pleaseSignInFirst'));
}

export function assertCurrentSession(session: AuthSession) {
  if (currentSession !== session) throw new Error(t('client.app.pleaseSignInFirst'));
}

export async function loadSession(): Promise<AuthSession | null> {
  if (currentSession !== undefined) return currentSession;
  const expected = epoch;
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (expected !== epoch || currentSession !== undefined) return currentSession ?? null;
    const candidate = raw ? JSON.parse(raw) as Partial<AuthSession> | null : null;
    if (!candidate?.baseUrl || !candidate.accessToken || !candidate.refreshToken || !candidate.email) return null;
    currentSession = candidate as AuthSession;
    return currentSession;
  } catch {
    return null;
  }
}

export async function persistSession(session: AuthSession) {
  assertCurrentSession(session);
  const expected = epoch;
  const serialized = JSON.stringify(session);
  await queueWrite(async () => {
    assertSessionEpoch(expected);
    assertCurrentSession(session);
    await SecureStore.setItemAsync(SESSION_KEY, serialized);
  });
  assertSessionEpoch(expected);
}

export async function activateSession(session: AuthSession, expected: number) {
  assertSessionEpoch(expected);
  currentSession = session;
  epoch += 1;
  await persistSession(session);
}

export function beginLogin() {
  // Invalidate requests begun before an explicit account/server switch.
  epoch += 1;
  return epoch;
}

export function clearSession() {
  currentSession = null;
  epoch += 1;
  return queueWrite(() => SecureStore.deleteItemAsync(SESSION_KEY)).catch(() => undefined);
}
