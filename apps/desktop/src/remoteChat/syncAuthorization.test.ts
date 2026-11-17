import { beforeEach, expect, it, vi } from 'vitest';
import type { ChatLink } from '../../../../shared/remote-chat/link';
import { RemoteConversationSync } from './conversationSync';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../api/backend', () => ({ invoke }));
beforeEach(() => invoke.mockReset().mockResolvedValue(undefined));
const owner = { owner: 'session-a', mode: 'direct' as const };
const start = { request: { action: 'nativeStart', id: 'bundle', direction: 'receive',
  transferId: 'transfer', epoch: 'epoch', size: 123, sha256: 'hash', offset: 0 } };

async function service() {
  const sync = new RemoteConversationSync();
  invoke.mockResolvedValueOnce({ id: 'bundle' });
  await sync.request({ request: { action: 'begin', size: 123, sha256: 'hash' } }, owner);
  // Only these readonly capabilities are read from an established link by the service.
  sync.attach(owner.owner, { nativeSyncHandle: { peer: 'trusted-peer', channel: 'trusted-channel' },
    nativeCipher: { handle: Promise.resolve('trusted-cipher') } } as unknown as ChatLink);
  return sync;
}

it('binds native transfers and polling to the authenticated owner and direct path', async () => {
  const sync = await service();
  await expect(sync.request(start, { ...owner, owner: 'session-b' })).rejects.toThrow('CONVERSATION_SYNC_INVALID');
  await expect(sync.request(start, { ...owner, mode: 'relay' })).rejects.toThrow('CONVERSATION_SYNC_INVALID');
  invoke.mockResolvedValueOnce('job');
  await sync.request({ request: { ...start.request, target: { peer: 'attacker' }, cipher: 'attacker' } }, owner);
  expect(invoke).toHaveBeenLastCalledWith('codex_conversation_sync_native_start', { request: {
    bundle: 'bundle', direction: 'receive', transferId: 'transfer', epoch: 'epoch', size: 123,
    sha256: 'hash', offset: 0, target: { peer: 'trusted-peer', channel: 'trusted-channel' }, cipher: 'trusted-cipher',
  } });
  await expect(sync.request({ request: { action: 'nativePoll', id: 'job' } },
    { ...owner, owner: 'session-b' })).rejects.toThrow('CONVERSATION_SYNC_INVALID');
  sync.release(owner.owner);
  expect(invoke).toHaveBeenLastCalledWith('codex_conversation_sync_native_close', { id: 'job' });
  await expect(sync.request({ request: { action: 'nativePoll', id: 'job' } }, owner))
    .rejects.toThrow('CONVERSATION_SYNC_INVALID');
});

it('drains a job that finishes opening after its owner disconnects', async () => {
  const sync = await service();
  let resolve!: (id: string) => void;
  invoke.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const result = sync.request(start, owner);
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  sync.release(owner.owner); resolve('late-job');
  await expect(result).rejects.toThrow('CONVERSATION_SYNC_CLOSED');
  expect(invoke).toHaveBeenLastCalledWith('codex_conversation_sync_native_close', { id: 'late-job' });
});
