// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getActiveSession, setActiveSession } from '../../../web/src/api';
import { signIn, signOut, store, deviceSocketMessage } from '../../../web/src/store';
import { ADMIN_REQUEST_TIMEOUT_MS } from '../../../../shared/http/requestDeadline';
import { credentials, deferred, json } from '../../../../shared/http/testing/adminClientContract';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setActiveSession(null); });

it.each(['timeout', 'offline'])('keeps a successful login when initial dashboard loading fails: %s', async failure => {
  setActiveSession(null);
  vi.useFakeTimers();
  const started = deferred<void>();
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.endsWith('/auth/login')) return json(credentials());
    started.resolve();
    if (failure === 'offline') throw new TypeError('offline');
    return new Promise<Response>(() => undefined);
  }));
  const pending = store.dispatch(signIn({ baseUrl: credentials().baseUrl, email: credentials().email, password: 'fixture' }));
  await started.promise;
  expect(store.getState().data.loading).toBe(true);
  if (failure === 'timeout') await vi.advanceTimersByTimeAsync(ADMIN_REQUEST_TIMEOUT_MS);
  const result = await pending;
  expect(signIn.rejected.match(result)).toBe(true);
  expect(getActiveSession()?.email).toBe(credentials().email);
  expect(store.getState().auth.session?.email).toBe(credentials().email);
  expect(store.getState().auth.submitting).toBe(false);
  expect(store.getState().data.loading).toBe(false);
});

it('does not clear a replacement login when an old login request returns late', async () => {
  const old = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(() => old.promise));
  const pending = store.dispatch(signIn({ baseUrl: credentials().baseUrl, email: credentials().email, password: 'fixture' }));
  const replacement = { ...credentials(), email: 'new@fixture.invalid' };
  setActiveSession(replacement);
  old.resolve(json(credentials()));
  await pending;
  expect(getActiveSession()).toBe(replacement);
  expect(store.getState().auth.session?.email).toBe(replacement.email);
});

it('does not clear a replacement session or its devices when an old logout completes', async () => {
  setActiveSession(credentials());
  const old = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(() => old.promise));
  const pending = store.dispatch(signOut());
  expect(getActiveSession()).toBeNull();
  const replacement = { ...credentials(), email: 'new@fixture.invalid' };
  setActiveSession(replacement);
  store.dispatch(deviceSocketMessage({ type: 'devices-snapshot', devices: [{ deviceId: 'new-pc',
    name: 'fixture', platform: 'Windows', online: false, lastSeenAt: '', activeAccountId: null,
    localProxyRunning: false, capabilities: [] }] }));
  old.resolve(json({}));
  await pending;
  expect(getActiveSession()).toBe(replacement);
  expect(store.getState().auth.session?.email).toBe(replacement.email);
  expect(store.getState().data.devices.map(device => device.deviceId)).toEqual(['new-pc']);
});
