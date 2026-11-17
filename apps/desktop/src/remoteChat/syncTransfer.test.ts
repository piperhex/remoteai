import { beforeEach, expect, it, vi } from 'vitest';
import { transferNativeSync } from './syncTransfer';
import type { SyncHost, SyncTransfer } from '../../../../shared/conversation/sync/types';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
beforeEach(() => { mocks.invoke.mockReset(); });

function fixture(localSource = false) {
  const calls: string[] = [];
  const abort = new AbortController();
  const remote: SyncHost = { id: 'remote', name: '', mode: () => 'direct',
    nativeLink: () => ({ cipher: Promise.resolve('session'), target: { peer: 'peer', channel: 'channel' } }),
    request: vi.fn(async request => {
      calls.push(request.action);
      return request.action === 'nativeStart' ? 'remote-job' : { written: 1024, finished: true };
    }) as SyncHost['request'] };
  const local: SyncHost = { id: 'local', name: '', nativeLocal: true, request: vi.fn() };
  mocks.invoke.mockImplementation(async (command: string) => {
    calls.push(command);
    return command.endsWith('_start') ? 'local-job' : { written: 1024, finished: true };
  });
  const bundle = { id: 'bundle', size: 1024, sha256: 'hash', sessionIds: [], binaryVersion: 1 };
  const options: SyncTransfer = { source: localSource ? local : remote, destination: localSource ? remote : local,
    sourceBundle: bundle, destinationBundle: bundle, offset: 0, signal: abort.signal, progress: vi.fn() };
  return { calls, options, abort, remote };
}

it.each([false, true])('binds the receiver before sending, validates progress and closes both jobs (%s)', async localSource => {
  const { calls, options } = fixture(localSource);
  expect(await transferNativeSync(options)).toBe(true);
  expect(calls.slice(0, 2)).toEqual(localSource
    ? ['nativeStart', 'codex_conversation_sync_native_start'] : ['codex_conversation_sync_native_start', 'nativeStart']);
  expect(options.progress).toHaveBeenCalledWith(1, 1024);
  expect(calls).toContain('nativeClose'); expect(calls).toContain('codex_conversation_sync_native_close');
});

it('preserves relay limits and old peer compatibility without opening a native transfer', async () => {
  const { remote, options } = fixture(); remote.mode = () => 'relay';
  expect(await transferNativeSync(options)).toBe(false);
  remote.mode = () => 'direct'; options.sourceBundle = { ...options.sourceBundle, binaryVersion: undefined };
  expect(await transferNativeSync(options)).toBe(false);
  expect(mocks.invoke).not.toHaveBeenCalled(); expect(remote.request).not.toHaveBeenCalled();
});

it('closes the registered receiver if cancellation arrives before the sender starts', async () => {
  const { abort, options, remote } = fixture();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command.endsWith('_start')) { abort.abort(); return 'receiver'; }
  });
  await expect(transferNativeSync(options)).rejects.toThrow();
  expect(remote.request).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith('codex_conversation_sync_native_close', { id: 'receiver' });
});

it('forwards between two remote hosts through the native bridge', async () => {
  const { calls, options, remote } = fixture();
  const destination: SyncHost = { ...remote, id: 'other-remote', request: vi.fn(async request => {
    calls.push(`destination:${request.action}`);
    return request.action === 'nativeStart' ? 'destination-job' : { finished: true, written: 1024 };
  }) as SyncHost['request'] };
  options.destination = destination;
  mocks.invoke.mockImplementation(async (command: string) => {
    calls.push(command);
    return command.endsWith('_bridge') ? 'bridge-job' : { written: 1024, finished: true };
  });
  expect(await transferNativeSync(options)).toBe(true);
  expect(calls.slice(0, 3)).toEqual(['destination:nativeStart', 'codex_conversation_sync_native_bridge', 'nativeStart']);
  expect(calls).toContain('destination:nativeClose'); expect(calls).toContain('nativeClose');
});
