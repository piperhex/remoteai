import { expect, it } from 'vitest';
import { loginOrigin } from '../../../../shared/browser/data/model';
import { validateLogin } from '../../../../shared/browser/data/crypto';
import { isPasswordFocus, matchingPasswords } from '../../../../shared/browser/data/passwordFocus';

it.each(['https://example.test', 'http://example.test', 'http://127.0.0.1:8016',
  'http://192.168.1.10:8080', 'http://localhost:8016', 'http://[::1]:8016'])(
  'accepts saving and input suggestions for %s', origin => {
    expect(loginOrigin(`${origin}/login?redirect=/`)).toBe(origin);
    expect(validateLogin({ origin, username: 'fixture', password: 'fictional-secret' })).toBe(true);
    expect(isPasswordFocus({ origin, username: '', id: 'focus-1', bounds: { x: 1, y: 1, width: 100, height: 30 },
      viewport: { width: 1280, height: 860 } })).toBe(true);
  });

it.each(['file:///login', 'ftp://example.test', 'data:text/html,login', 'javascript:void(0)',
  'http://user:secret@example.test', 'https://user:secret@example.test'])(
  'rejects non-web or embedded-credential addresses: %s', origin => {
    expect(loginOrigin(origin)).toBeUndefined();
    expect(validateLogin({ origin, username: 'fixture', password: 'fictional-secret' })).toBe(false);
  });

it('keeps HTTP, HTTPS and mapped ports separate when matching passwords', () => {
  const focus = { origin: 'http://127.0.0.1:8016', username: '', id: 'focus-1',
    bounds: { x: 1, y: 1, width: 100, height: 30 }, viewport: { width: 1280, height: 860 } };
  const entries = ['http://127.0.0.1:8016', 'https://127.0.0.1:8016', 'http://127.0.0.1:8017']
    .map((origin, index) => ({ id: String(index), at: index, origin, username: 'fixture', password: 'fictional-secret' }));
  expect(matchingPasswords(entries, focus)).toEqual([entries[0]]);
});

it('offers only the active username at the second step and accepts a valid continuation ID', () => {
  const focus = { origin: 'https://example.test', username: 'alice', id: 'focus-2', stage: 'password' as const,
    continuationId: 'focus-1', bounds: { x: 1, y: 1, width: 100, height: 30 },
    viewport: { width: 1280, height: 860 } };
  const entries = ['alice', 'bob'].map((username, at) => ({ id: username, at, origin: focus.origin,
    username, password: 'fictional-secret' }));
  expect(isPasswordFocus(focus)).toBe(true);
  expect(isPasswordFocus({ ...focus, stage: 'username' })).toBe(false);
  expect(isPasswordFocus({ ...focus, username: '' })).toBe(false);
  expect(matchingPasswords(entries, focus)).toEqual([entries[0]]);
});
