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

it('uses 60s reconciliation only after negotiation and returns to 3s polling on disconnect', async () => {
  vi.useFakeTimers();
  invoke.mockResolvedValue(reply([]));
  const stop = store.watch(true);
  try {
    await vi.advanceTimersByTimeAsync(3_000);
    expect(invoke).toHaveBeenCalledTimes(2);
    store.setEventsOnline(true);
    store.invalidate();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(invoke).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledTimes(4);
    store.setEventsOnline(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(invoke).toHaveBeenCalledTimes(5);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(invoke).toHaveBeenCalledTimes(5);
  } finally { stop(); vi.useRealTimers(); }
});

it('coalesces invalidations received during a list request into one fresh read', async () => {
  let release!: (value: unknown) => void;
  invoke.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockResolvedValueOnce(reply([]));
  const first = store.refresh();
  store.invalidate(); store.invalidate();
  expect(invoke).toHaveBeenCalledTimes(1);
  release(reply()); await first;
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(store.snapshot().requests).toEqual([]);
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

it('opens an email form for group chat without sending an invitation', () => {
  store.request();
  expect(store.snapshot()).toMatchObject({ dialog: true, email: '', busy: false });
  expect(invoke).not.toHaveBeenCalled();
});

it('checks host permissions before inviting a chat account without exposing its email',
  async () => {
    invoke.mockResolvedValueOnce({ enabled: false, control: false });
    store.request({ id: 'bob-id', account: 'bob' });
    await vi.waitFor(() => expect(store.snapshot().busy).toBe(false));
    expect(invoke).toHaveBeenCalledExactlyOnceWith('remote_desktop_permissions');
    expect(store.snapshot()).toMatchObject({ dialog: true, email: '', requests: [] });
    expect(store.snapshot().error).toContain('允许远程桌面和键鼠控制');
    invoke.mockResolvedValueOnce({ enabled: true, control: true }).mockResolvedValueOnce(reply());
    expect(await store.inviteSelected()).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('remote_assistance', {
      request: { kind: 'inviteAccount', userId: 'bob-id' },
    });
    store.reset(false);
    expect(store.snapshot().email).toBe('');
  });

it('invites the confirmed chat account by ID when account prefixes can be shared', async () => {
  invoke.mockResolvedValueOnce({ enabled: true, control: true }).mockResolvedValueOnce(reply());
  store.request({ id: 'bob-id', account: 'bob' });
  await vi.waitFor(() => expect(store.snapshot().busy).toBe(false));
  expect(invoke).toHaveBeenLastCalledWith('remote_assistance', {
    request: { kind: 'inviteAccount', userId: 'bob-id' },
  });
  expect(store.allows('invite')).toBe(true);
});

it('reopens an active invitation without inviting another chat recipient', async () => {
  invoke.mockResolvedValueOnce(reply()); await store.refresh();
  invoke.mockClear();
  store.request({ id: 'someone-else-id', account: 'someone-else' });
  expect(store.snapshot().dialog).toBe(true);
  expect(store.snapshot().requests).toEqual([invitation]);
  expect(invoke).not.toHaveBeenCalled();
});
