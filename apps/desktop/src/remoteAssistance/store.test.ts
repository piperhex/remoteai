import { beforeEach, expect, it, vi } from 'vitest';
import { AssistanceStore, type AssistanceInvitation } from './store';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const invitation: AssistanceInvitation = { id: 'invite', hostDeviceId: 'host', hostEmail: 'host@example.com',
  hostName: 'Host PC', helperEmail: 'helper@example.com', state: 'pending', expiresAt: '2099-01-01T00:00:00Z' };
const reply = (requests = [invitation]) => ({ identity: { userId: 'user', baseUrl: 'https://example.test' },
  currentDeviceId: 'host', requests });
let store: AssistanceStore;
beforeEach(() => { invoke.mockReset(); store = new AssistanceStore(); store.reset(true); });

it('keeps polling single-flight and ignores results from before logout', async () => {
  let complete!: (value: unknown) => void;
  invoke.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const first = store.refresh();
  await store.refresh();
  expect(invoke).toHaveBeenCalledTimes(1);
  store.reset(false);
  complete(reply()); await first;
  expect(store.snapshot().requests).toEqual([]);
  expect(store.allows('invite')).toBe(false);
});

it('revokes local access immediately when ending fails to reach the cloud', async () => {
  invoke.mockResolvedValueOnce(reply()); await store.refresh();
  expect(store.allows('invite')).toBe(true);
  const listener = vi.fn(); store.subscribe(listener);
  invoke.mockRejectedValueOnce('暂时无法连接');
  const ending = store.respond('invite', 'end');
  expect(store.allows('invite')).toBe(false);
  expect(listener).toHaveBeenCalled();
  expect(await ending).toBe(false);
  invoke.mockResolvedValueOnce(reply()); await store.refresh();
  expect(store.allows('invite')).toBe(false);
  expect(store.snapshot().error).toBe('暂时无法连接');
});

it('never lets a stale poll overwrite a newly accepted invitation', async () => {
  let complete!: (value: unknown) => void;
  invoke.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const polling = store.refresh();
  invoke.mockResolvedValueOnce(reply([{ ...invitation, state: 'accepted', helperDeviceId: 'helper' }]));
  expect(await store.respond('invite', 'accept')).toBe(true);
  complete(reply()); await polling;
  expect(store.snapshot().requests[0].state).toBe('accepted');
  expect(store.snapshot().viewerId).toBe('invite');
});

it('validates email and existing host permissions without silently changing settings', async () => {
  expect(await store.invite('not an email')).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  invoke.mockResolvedValueOnce({ enabled: true, control: false });
  expect(await store.invite('helper@example.com')).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(store.snapshot().error).toContain('允许远程桌面和键鼠控制');
});

it('sends a trimmed recipient and records local consent only after successful creation', async () => {
  invoke.mockResolvedValueOnce({ enabled: true, control: true }).mockResolvedValueOnce(reply());
  expect(await store.invite(' helper@example.com ')).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith('remote_assistance', {
    request: { kind: 'invite', email: 'helper@example.com' },
  });
  expect(store.allows('invite')).toBe(true);
  store.reset(false);
  expect(store.allows('invite')).toBe(false);
});
