import { beforeEach, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import { credentials, deferred, json, renewed } from '../../../../shared/http/testing/adminClientContract';
import { refreshSession, authorizedRequest } from './adminSession';
import { activateSession, clearSession, loadSession, sessionEpoch } from './sessionStore';

const storage = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => storage.value),
  setItemAsync: vi.fn(async (_key: string, value: string) => { storage.value = value; }),
  deleteItemAsync: vi.fn(async () => { storage.value = null; }),
}));
beforeEach(async () => { await clearSession(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('serializes secure-store writes so an in-flight old refresh cannot overwrite a new login', async () => {
  const old = credentials();
  await activateSession(old, sessionEpoch());
  const writing = deferred<void>();
  const finish = deferred<void>();
  vi.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (_key, value) => {
    writing.resolve(); await finish.promise; storage.value = value;
  });
  vi.stubGlobal('fetch', vi.fn(async () => json(renewed)));
  const pending = expect(refreshSession(old)).rejects.toBeInstanceOf(Error);
  await writing.promise;
  const replacement = { ...credentials(), email: 'new@fixture.invalid', baseUrl: 'https://other.invalid' };
  const activated = activateSession(replacement, sessionEpoch());
  finish.resolve();
  await Promise.all([pending, activated]);
  expect(JSON.parse(storage.value!)).toEqual(replacement);
  expect(await loadSession()).toBe(replacement);
});

it('cannot restore a logged out account when a refresh completes late', async () => {
  const old = credentials();
  await activateSession(old, sessionEpoch());
  const work = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(() => work.promise));
  const pending = expect(refreshSession(old)).rejects.toBeInstanceOf(Error);
  await clearSession();
  work.resolve(json(renewed));
  await pending;
  expect(await loadSession()).toBeNull();
  expect(storage.value).toBeNull();
});

it('clears expired credentials only for the current session', async () => {
  const old = credentials();
  await activateSession(old, sessionEpoch());
  vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
  await expect(authorizedRequest(old, '/read')).rejects.toMatchObject({ name: 'SessionExpiredError', status: 401 });
  expect(storage.value).toBeNull();
});

it('never clears a replacement login after a delayed retry 401', async () => {
  const old = credentials();
  await activateSession(old, sessionEpoch());
  const retry = deferred<Response>();
  const started = deferred<void>();
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
    if (input.endsWith('/auth/refresh')) return json(renewed);
    if (new Headers(init.headers).get('Authorization') === 'Bearer old-access') return json({}, 401);
    started.resolve(); return retry.promise;
  }));
  const pending = expect(authorizedRequest(old, '/write', { method: 'POST' })).rejects.toBeInstanceOf(Error);
  await started.promise;
  const replacement = { ...credentials(), email: 'replacement@fixture.invalid' };
  await activateSession(replacement, sessionEpoch());
  retry.resolve(json({}, 401));
  await pending;
  expect(JSON.parse(storage.value!)).toEqual(replacement);
});
