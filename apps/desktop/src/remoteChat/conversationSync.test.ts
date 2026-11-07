import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SyncRelayRate } from '../../../../shared/conversation/sync/rate';
import { closePreparedSync, prepareSync, uploadPreparedSync } from '../../../../shared/conversation/sync/transfer';
import { DEFAULT_CHAT_POLICY, parseChatPolicy } from '../../../../shared/chat/chatPolicy';
import type { SyncHost, SyncRequest } from '../../../../shared/conversation/sync/types';
import { RemoteConversationSync } from './conversationSync';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../api/backend', () => ({ invoke }));
beforeEach(() => { invoke.mockReset(); });

describe('sync Relay pacing', () => {
  it('defaults to 200 KiB/s and accepts authenticated server overrides', () => {
    const policy = { ...DEFAULT_CHAT_POLICY };
    expect(parseChatPolicy(policy).conversationSyncRelayKbps).toBe(200);
    expect(parseChatPolicy({ ...policy, conversationSyncRelayKbps: 800 }).conversationSyncRelayKbps).toBe(800);
    const { conversationSyncRelayKbps: removed, ...old } = policy;
    expect(removed).toBe(200);
    expect(parseChatPolicy(old).conversationSyncRelayKbps).toBe(200);
    expect(() => parseChatPolicy({ ...policy, conversationSyncRelayKbps: 0 })).toThrow();
  });

  it('paces Relay bytes while P2P bypasses waits and a path upgrade interrupts a pending wait', async () => {
    let now = 0;
    let direct = false;
    const sleep = vi.fn(async (ms: number) => { now += ms; });
    const rate = new SyncRelayRate(() => now, sleep);
    const options = { direct: () => direct, kibPerSecond: () => 200 };
    await rate.wait(200 * 1024, options);
    expect(now).toBe(1000);
    direct = true;
    await rate.wait(4 * 1024 * 1024, options);
    expect(now).toBe(1000);
    direct = false;
    sleep.mockImplementation(async ms => { now += ms; direct = true; });
    await rate.wait(200 * 1024, options);
    expect(now).toBe(1050);
  });
});

function host(id: string, responses: Partial<Record<SyncRequest['action'], unknown>>): SyncHost {
  return { id, name: id,
    request: vi.fn(async (request: SyncRequest) => responses[request.action]) as SyncHost['request'] };
}

it('local synchronization prepares a move without uploading a copy', async () => {
  const local = host('local', { prepare: { id: 'prepared' }, plan: { count: 1, duplicateIds: [] } });
  const result = await prepareSync({ source: { key: 'local', host: local,
    home: { id: 'default', path: '/home/.codex', enabled: true }, label: 'PC · /home/.codex' },
    destination: local, sessionIds: ['thread'], signal: new AbortController().signal });
  expect(result.id).toBe('prepared');
  expect(local.request).toHaveBeenNthCalledWith(1, { action: 'prepare', homeId: 'default', sessionIds: ['thread'] });
  expect(local.request).toHaveBeenNthCalledWith(2, { action: 'plan', id: 'prepared' });
});

it('remote sync transfers fixed chunks without ever requesting source removal', async () => {
  const source = host('remote', { export: { id: 'export', size: 20_000, sha256: 'hash',
    sessionIds: ['selected', 'duplicate'] }, read: { data: 'chunk' } });
  const destination = host('local', { begin: { id: 'import' }, plan: { count: 2, duplicateIds: ['duplicate'] } });
  const progress = vi.fn();
  const result = await prepareSync({ source: { key: 'remote', host: source,
    home: { id: 'work', path: '/work/.codex', enabled: false }, label: 'Remote · /work/.codex' },
    destination, sessionIds: ['selected'], signal: new AbortController().signal });
  expect(result.id).toBe('import');
  expect(result.plan).toEqual({ count: 2, duplicateIds: ['duplicate'] });
  expect(source.request).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'read' }));
  expect(destination.request).toHaveBeenCalledWith({ action: 'plan', id: 'import',
    sessionIds: ['selected', 'duplicate'] });
  await uploadPreparedSync({ prepared: result, destination, signal: new AbortController().signal, progress });
  await closePreparedSync(destination, result);
  expect(source.request).toHaveBeenCalledWith({ action: 'close', id: 'export' });
  expect(source.request).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepare' }));
  expect(destination.request).toHaveBeenCalledWith({ action: 'write', id: 'import', offset: 12_288, data: 'chunk' });
  expect(progress).toHaveBeenLastCalledWith(1, 7712);
});

it('a dropped connection cleans both temporary transfers without committing', async () => {
  const source = host('remote', { export: { id: 'export', size: 2000, sha256: 'hash' } });
  const destination = host('local', { begin: { id: 'import' }, plan: { count: 1, duplicateIds: [] } });
  vi.mocked(source.request).mockImplementation(async request => {
    if (request.action === 'read') throw new Error('disconnected');
    return (request.action === 'export' ? { id: 'export', size: 2000, sha256: 'hash', sessionIds: ['selected'] } : {}) as never;
  });
  const prepared = await prepareSync({ source: { key: 'remote', host: source,
    home: { id: 'work', path: '/work', enabled: true }, label: 'Remote · /work' }, destination,
    sessionIds: ['selected'], signal: new AbortController().signal });
  await expect(uploadPreparedSync({ prepared, destination, signal: new AbortController().signal,
    progress: vi.fn() })).rejects.toThrow('disconnected');
  await closePreparedSync(destination, prepared);
  expect(source.request).toHaveBeenCalledWith({ action: 'close', id: 'export' });
  expect(destination.request).toHaveBeenCalledWith({ action: 'close', id: 'import' });
  expect(destination.request).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'commit' }));
});

it('remote peers may only use transfers created in their own session', async () => {
  const sync = new RemoteConversationSync();
  invoke.mockResolvedValue({ id: 'owned' });
  await sync.request({ request: { action: 'export', homeId: 'default', sessionIds: ['thread'] } },
    { owner: 'session-a', mode: 'direct' });
  await expect(sync.request({ request: { action: 'read', id: 'owned', offset: 0 } },
    { owner: 'session-b', mode: 'direct' })).rejects.toThrow('CONVERSATION_SYNC_INVALID');
  await sync.request({ request: { action: 'read', id: 'owned', offset: 0 } }, { owner: 'session-a', mode: 'direct' });
  expect(invoke).toHaveBeenLastCalledWith('codex_conversation_sync', { request: { action: 'read', id: 'owned', offset: 0 } });
  sync.release('session-a');
  expect(invoke).toHaveBeenLastCalledWith('codex_conversation_sync', { request: { action: 'close', id: 'owned' } });
});
