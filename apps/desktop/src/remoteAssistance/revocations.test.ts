// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rememberRevocation, revokedInvitations } from './revocations';
beforeEach(() => localStorage.clear());
afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

it('retains cancellation across reloads and removes expired grants', () => {
  vi.useFakeTimers();
  rememberRevocation('active', new Date(Date.now() + 60_000).toISOString());
  expect(revokedInvitations()).toEqual(new Set(['active']));
  vi.advanceTimersByTime(126 * 60_000);
  expect(revokedInvitations().size).toBe(0);
});

it('keeps a pending cancellation revoked when concurrent acceptance extends the cloud grant', () => {
  vi.useFakeTimers();
  rememberRevocation('pending', new Date(Date.now() + 5 * 60_000).toISOString());
  vi.advanceTimersByTime(124 * 60_000);
  expect(revokedInvitations().has('pending')).toBe(true);
});

it('ignores malformed saved data without turning it into a grant', () => {
  localStorage.setItem('remote-assistance-revocations', '{invalid');
  expect(revokedInvitations().size).toBe(0);
  rememberRevocation('cancelled');
  expect(revokedInvitations().has('cancelled')).toBe(true);
});
