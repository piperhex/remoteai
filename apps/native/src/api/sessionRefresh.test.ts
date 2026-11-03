import { afterEach, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import { refreshSession } from './client';
import { activateSession, sessionEpoch } from './sessionStore';

vi.mock('expo-secure-store', () => ({ setItemAsync: vi.fn(async () => undefined) }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

const credentials = () => ({ baseUrl: 'https://test.example', email: 'owner@example.com',
  accessToken: 'old-access', refreshToken: 'old-refresh' });

it('renews before an API rejects the token and retains the chat session object', async () => {
  const session = credentials();
  await activateSession(session, sessionEpoch());
  vi.clearAllMocks();
  const renewed = { accessToken: 'new-access', refreshToken: 'new-refresh' };
  const fetch = vi.fn(async () => new Response(JSON.stringify(renewed)));
  vi.stubGlobal('fetch', fetch);
  const [first, second] = await Promise.all([refreshSession(session), refreshSession(session)]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(first).toBe(session);
  expect(second).toBe(session);
  expect(session).toMatchObject(renewed);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(expect.any(String), JSON.stringify(session));
});

it.each([401, 503])('preserves status %s for renewal recovery without overwriting credentials', async status => {
  const session = credentials();
  await activateSession(session, sessionEpoch());
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
  await expect(refreshSession(session)).rejects.toMatchObject({ status });
  expect(session).toEqual(credentials());
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
