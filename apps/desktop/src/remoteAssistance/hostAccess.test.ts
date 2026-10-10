import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssistanceHostAccess } from './hostAccess';
import { assistanceStore } from './store';
import type { RpcRequest } from '../../../../shared/remote-chat/protocol';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
let access: AssistanceHostAccess;
const drop = vi.fn();
beforeEach(async () => {
  invoke.mockReset(); drop.mockReset(); assistanceStore.reset(true);
  invoke.mockResolvedValue({ currentDeviceId: 'host', identity: { userId: 'owner', baseUrl: 'https://test' },
    requests: [{ id: 'invitation', hostDeviceId: 'host', state: 'accepted', expiresAt: '2099-01-01T00:00:00Z' }] });
  await assistanceStore.refresh();
  access = new AssistanceHostAccess(drop);
});
afterEach(() => { access.close(); assistanceStore.reset(false); });

it('requires local consent and keeps cross-account sessions separate from normal owner access', () => {
  expect(access.admit('unknown', 'uninvited')).toBe(false);
  expect(access.admit('bad', null)).toBe(false);
  expect(access.admit('owner', undefined)).toBe(true);
  expect(access.admit('helper', 'invitation')).toBe(true);
  expect(access.restricted('helper')).toBe(true);
  expect(access.restricted('owner')).toBe(false);
});

it('blocks chat, terminals, file downloads, approvals and privacy mode for assistance sessions', () => {
  access.admit('helper', 'invitation');
  const base: RpcRequest = { kind: 'request', id: 'rpc', method: 'request', body: {} };
  for (const operation of ['list', 'read', 'send', 'guiTerminalOpen', 'downloadOpen', 'fileBulk', 'guiAccountsRead']) {
    expect(access.denied('helper', { ...base, body: { operation } })?.error).toBeTruthy();
  }
  expect(access.denied('helper', { ...base, method: 'connect' })?.error).toBeTruthy();
  expect(access.denied('helper', { ...base, method: 'respond' })?.error).toBeTruthy();
  expect(access.denied('helper', { ...base, body: { operation: 'remoteDesktop', action: 'privacy' } })?.error)
    .toBeTruthy();
  expect(access.denied('helper', { ...base, body: { operation: 'remoteDesktop', action: 'open' } })).toBeUndefined();
  expect(access.denied('owner', { ...base, body: { operation: 'send' } })).toBeUndefined();
});

it('drops assistance immediately on cancellation or logout, including direct connections', async () => {
  access.admit('helper', 'invitation');
  invoke.mockRejectedValueOnce('offline');
  const ending = assistanceStore.respond('invitation', 'end');
  expect(drop).toHaveBeenCalledWith('helper');
  await ending;
  expect(access.admit('new-helper', 'invitation')).toBe(false);
});
