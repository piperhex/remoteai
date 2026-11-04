// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getActiveSession, refreshSession, setActiveSession } from '../../../web/src/api';
import { t } from '../../../../shared/localization/browserClient';

const session = { baseUrl: 'https://test.example', email: 'owner@example.com',
  accessToken: 'old-access', refreshToken: 'old-refresh' };
const renewed = { accessToken: 'new-access', refreshToken: 'new-refresh' };
beforeEach(() => { setActiveSession({ ...session }); });
afterEach(() => { setActiveSession(null); vi.unstubAllGlobals(); });

it('shares a credential refresh across chats and persists the rotated credentials', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify(renewed)));
  vi.stubGlobal('fetch', fetch);
  const [first, second] = await Promise.all([refreshSession(), refreshSession()]);
  expect(fetch).toHaveBeenCalledOnce();
  expect(first).toBe(second);
  expect(getActiveSession()).toMatchObject(renewed);
});

it('retains valid credentials during a temporary renewal failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
  await expect(refreshSession()).rejects.toMatchObject({ status: 503 });
  expect(getActiveSession()).toEqual(session);
});

it('clears rejected credentials and reports the authorization status', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
  await expect(refreshSession()).rejects.toMatchObject({ status: 401 });
  expect(getActiveSession()).toBeNull();
});

it('does not restore an old login after logout or overwrite a replacement account', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = refreshSession();
  const rejected = expect(pending).rejects.toThrow(t('client.app.pleaseSignInFirst'));
  const replacement = { ...session, email: 'new@example.com' };
  setActiveSession(replacement);
  finish(new Response(JSON.stringify(renewed)));
  await rejected;
  expect(getActiveSession()).toBe(replacement);
});
