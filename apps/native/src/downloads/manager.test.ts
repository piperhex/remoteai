import { beforeEach, expect, it, vi } from 'vitest';
import type { DownloadConnection, DownloadRequest } from './types';
import { BulkTransport } from '../../../../shared/remote-chat/bulkTransport';
import { downloadBulkClient } from '../../../../shared/remote-chat/client/bulkClient';
import { NativeBulkChannel } from '../../../../shared/remote-chat/nativeBulkChannel';
import type { ChatLink } from '../../../../shared/remote-chat/link';

const mocks = vi.hoisted(() => ({
  events: new Map<string, (value: string) => void>(),
  bridge: { list: vi.fn(), enqueue: vi.fn(), pause: vi.fn(), resume: vi.fn(), delete: vi.fn(),
    connection: vi.fn(), accept: vi.fn(), invalidateBulk: vi.fn() },
}));
vi.mock('react-native', () => ({ NativeModules: { FileDownloads: mocks.bridge },
  Platform: { OS: 'android', Version: 35 }, PermissionsAndroid: {},
  DeviceEventEmitter: { addListener: (event: string, callback: (value: string) => void) => {
    mocks.events.set(event, callback);
    return { remove: () => mocks.events.delete(event) };
  } },
}));
vi.mock('react-native-blob-util', () => ({ default: { android: { actionViewIntent: vi.fn() } } }));

function connection(): DownloadConnection {
  const files = { open: vi.fn(), read: vi.fn(), close: vi.fn() };
  return { owner: 'owner', deviceId: 'pc', deviceName: 'PC', ready: true, mode: 'direct', windowSize: 5,
    threadId: 'thread', cwd: 'F:/project', files, client: { ...files, browse: vi.fn() } };
}
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); mocks.events.clear();
  mocks.bridge.list.mockResolvedValue('[]');
  mocks.bridge.connection.mockResolvedValue(undefined);
  mocks.bridge.accept.mockResolvedValue(true);
  mocks.bridge.invalidateBulk.mockResolvedValue(undefined);
});

it('continues forwarding native task requests after the last download view unsubscribes', async () => {
  const { downloadManager } = await import('./manager');
  const current = connection();
  vi.mocked(current.client.read).mockResolvedValue({ offset: 262144, data: 'AA==' });
  downloadManager.bind(current);
  await downloadManager.initialize();
  const unsubscribe = downloadManager.subscribe(vi.fn());
  unsubscribe();
  const request: DownloadRequest = { requestId: 'request', taskId: 'task', operation: 'read', remoteId: 'handle',
    offset: 262144, length: 1, source: { owner: 'owner', deviceId: 'pc', deviceName: 'PC',
      scope: 'project', path: 'F:/project/a.zip' } };
  mocks.events.get('downloadRequest')!(JSON.stringify(request));
  await vi.waitFor(() => expect(mocks.bridge.accept).toHaveBeenCalled());
  expect(current.client.read).toHaveBeenCalledWith({ threadId: 'task', id: 'handle', offset: 262144, length: 1 });
  expect(mocks.bridge.pause).not.toHaveBeenCalled();
  expect(mocks.bridge.connection).not.toHaveBeenCalledWith('owner', 'pc', 0);
});

it('does not resubmit connection or disk work for unrelated chat updates', async () => {
  const { downloadManager } = await import('./manager');
  const current = connection();
  downloadManager.bind(current); await downloadManager.initialize();
  for (let i = 0; i < 20; i++) downloadManager.bind({ ...current });
  downloadManager.bind({ ...current, threadId: 'another-thread' });
  await Promise.resolve();
  expect(mocks.bridge.connection).toHaveBeenCalledTimes(1);
  expect(mocks.bridge.list).toHaveBeenCalledTimes(1);
});

it('pauses disconnected tasks and never forwards their reads to a newly selected computer', async () => {
  const { downloadManager } = await import('./manager');
  const first = connection();
  downloadManager.bind(first); await downloadManager.initialize();
  downloadManager.unbind(first.files);
  const second = { ...connection(), deviceId: 'another-pc' };
  downloadManager.bind(second);
  await Promise.resolve();
  mocks.events.get('downloadRequest')!(JSON.stringify({ requestId: 'late', taskId: 'task', operation: 'read',
    source: { owner: 'owner', deviceId: 'pc' }, remoteId: 'handle', offset: 0, length: 1 }));
  await vi.waitFor(() => expect(mocks.bridge.accept).toHaveBeenCalledWith('late', null, true));
  expect(mocks.bridge.connection).toHaveBeenCalledWith('owner', 'pc', 0);
  expect(second.client.read).not.toHaveBeenCalled();
});

it('updates the native window when an administrator changes the count during a download', async () => {
  const { downloadManager } = await import('./manager');
  const current = connection();
  downloadManager.bind(current); await downloadManager.initialize();
  expect(mocks.bridge.connection).toHaveBeenLastCalledWith('owner', 'pc', 5);
  downloadManager.bind({ ...current, windowSize: 2 });
  await vi.waitFor(() => expect(mocks.bridge.connection).toHaveBeenLastCalledWith('owner', 'pc', 2));
  downloadManager.bind({ ...current, ready: false });
  await vi.waitFor(() => expect(mocks.bridge.connection).toHaveBeenLastCalledWith('owner', 'pc', 0));
});

it('restores saved tasks and releases failed initialization listeners before retrying', async () => {
  const { downloadManager } = await import('./manager');
  mocks.bridge.list.mockRejectedValueOnce(new Error('Unavailable'));
  await downloadManager.initialize();
  expect(mocks.events.size).toBe(0);
  mocks.bridge.list.mockResolvedValue('[{"id":"saved","status":"paused","received":262144}]');
  await downloadManager.initialize();
  expect(downloadManager.snapshot()).toEqual([{ id: 'saved', status: 'paused', received: 262144 }]);
  expect(mocks.events.size).toBe(2);
});

it('invalidates native downloads when the file channel closes without changing the chat mode', async () => {
  const { downloadManager } = await import('./manager');
  const current = connection();
  const transport = new BulkTransport(); transport.setMode('direct');
  const channel = new NativeBulkChannel(); transport.attach(channel, 'native');
  current.client.bulk = downloadBulkClient({ peer: () => 'pc', supported: () => true,
    link: () => ({ bulk: transport }) as ChatLink, request: vi.fn() });
  downloadManager.bind(current); await downloadManager.initialize();
  downloadManager.pause('task'); channel.close();
  expect(mocks.bridge.pause).toHaveBeenCalledWith('task');
  expect(mocks.bridge.resume).not.toHaveBeenCalled();
  expect(mocks.bridge.invalidateBulk).toHaveBeenCalledOnce();
  expect(mocks.bridge.invalidateBulk).toHaveBeenCalledWith('owner', 'pc');
  downloadManager.unbind(current.files);
  transport.invalidate(); expect(mocks.bridge.invalidateBulk).toHaveBeenCalledOnce();
});
