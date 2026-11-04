// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sshDownloadClient } from '../../../../shared/terminal/sshDownloadClient';
import type { SshApi, SshFileReply } from '../../../../shared/terminal/ssh';
import { FILE_CHUNK_BYTES, validateFileInfo } from '../../../../shared/remote-chat/fileDownload';
import { WebDownloadManager, downloadManager } from '../../../../shared/downloads/manager';
import { enqueueSshDownload } from '../../../../shared/downloads/sshDownload';
import type { DownloadConnection, DownloadSource, DownloadTask } from '../../../../shared/downloads/types';

const storage = vi.hoisted(() => ({ tasks: new Map<string, DownloadTask>(), chunks: new Map<number, string>() }));
vi.mock('../../../../shared/downloads/storage', () => ({
  listDownloads: async () => [],
  storeDownload: async (task: DownloadTask) => { storage.tasks.set(task.id, structuredClone(task)); },
  resetDownload: async () => { storage.chunks.clear(); },
  storeChunk: async (_task: DownloadTask, offset: number, data: string) => { storage.chunks.set(offset, data); },
  deleteDownload: async (id: string) => { storage.tasks.delete(id); },
}));

beforeEach(() => { storage.tasks.clear(); storage.chunks.clear(); });
afterEach(() => vi.restoreAllMocks());

function fixture() {
  let bytes = Buffer.alloc(6 * 1024 * 1024 + 17, 0x41);
  const files = vi.fn<SshApi['files']>(async (_id, request): Promise<SshFileReply> => {
    if (request.type === 'list') return { type: 'list', path: '/', truncated: false,
      entries: [{ name: 'data.bin', path: '/data.bin', size: bytes.length, directory: false }] };
    if (request.type === 'readChunk') return { type: 'file',
      data: bytes.subarray(request.offset, request.offset + request.length).toString('base64') };
    throw new Error('Unexpected SSH operation');
  });
  const api: SshApi = { files, profiles: {} as SshApi['profiles'], open: vi.fn(), probe: vi.fn() };
  const unused = vi.fn(async (): Promise<never> => { throw new Error('Used host file transport for SSH'); });
  const connection: DownloadConnection = { owner: 'owner', deviceId: 'computer', deviceName: 'Computer',
    ready: true, mode: 'direct', ssh: api,
    client: { open: unused, read: unused, close: unused, browse: unused },
    files: { open: unused, read: unused, close: unused } };
  const source: DownloadSource = { owner: connection.owner, deviceId: connection.deviceId,
    deviceName: connection.deviceName, scope: 'computer', path: '/data.bin', sshSessionId: 'ssh-one' };
  return { api, files, source, connection, unused, size: bytes.length,
    replace: () => { bytes = Buffer.alloc(bytes.length, 0x42); } };
}

it('adapts large SSH files to bounded reads and isolates handles by transfer', async () => {
  const state = fixture();
  const client = sshDownloadClient(state.api, 'ssh-one');
  const info = await client.open({ ...state.source, transferId: 'download' });
  expect(validateFileInfo(info, 'direct')).toMatchObject({ size: state.size, name: 'data.bin' });
  expect(info.revision).toBeUndefined();
  const read = { id: info.id, threadId: 'download', offset: 0, length: FILE_CHUNK_BYTES };
  await expect(client.read({ ...read, threadId: 'other' })).rejects.toThrow();
  await expect(client.read({ ...read, length: FILE_CHUNK_BYTES + 1 })).rejects.toThrow();
  expect((await client.read(read)).data.length).toBe(Math.ceil(FILE_CHUNK_BYTES / 3) * 4);
  expect(state.files).toHaveBeenLastCalledWith('ssh-one', {
    type: 'readChunk', path: '/data.bin', offset: 0, length: FILE_CHUNK_BYTES,
  });
  await client.close('download', info.id);
  await expect(client.read(read)).rejects.toThrow();
  const abort = new AbortController(); abort.abort();
  await expect(client.open({ ...state.source, transferId: 'cancelled' }, { signal: abort.signal })).rejects.toThrow();
});

it('queues against the matching SSH connection instead of the currently viewed computer', async () => {
  const state = fixture();
  const enqueue = vi.spyOn(downloadManager, 'enqueue').mockResolvedValue('download');
  downloadManager.register(state.connection);
  const other = { ...fixture().connection, owner: 'other-owner', deviceId: 'other-computer' };
  downloadManager.register(other);
  try {
    await expect(enqueueSshDownload(state.api, 'ssh-one', { cwd: '/', path: '/data.bin' }))
      .resolves.toBe('client.downloads.addedToDownloads');
    expect(enqueue).toHaveBeenCalledWith(state.source);
    downloadManager.unbind(state.connection.files);
    await expect(enqueueSshDownload(state.api, 'ssh-one', { cwd: '/', path: '/data.bin' }))
      .rejects.toThrow('client.ssh.closed');
  } finally { downloadManager.unbind(state.connection.files); downloadManager.unbind(other.files); }
});

it('does not merge identical paths from different SSH sessions or the host computer', async () => {
  const state = fixture();
  const manager = new WebDownloadManager();
  manager.register({ ...state.connection, ready: false });
  const first = await manager.enqueue(state.source);
  expect(await manager.enqueue(state.source)).toBe(first);
  expect(await manager.enqueue({ ...state.source, sshSessionId: 'ssh-two' })).not.toBe(first);
  expect(await manager.enqueue({ ...state.source, sshSessionId: undefined })).not.toBe(first);
  expect(manager.snapshot()).toHaveLength(3);
  expect(state.unused).not.toHaveBeenCalled();
});

it('reports real progress, pauses, and restarts without mixing previously downloaded bytes', async () => {
  const state = fixture();
  const original = state.files.getMockImplementation()!;
  const pending: (() => void)[] = [];
  let hold = true;
  state.files.mockImplementation(async (id, request) => {
    if (hold && request.type === 'readChunk' && request.offset > 0) {
      await new Promise<void>(resolve => pending.push(resolve));
    }
    return original(id, request);
  });
  const manager = new WebDownloadManager(); manager.register(state.connection);
  const id = await manager.enqueue(state.source);
  await vi.waitFor(() => expect(manager.snapshot()[0]).toMatchObject({
    received: FILE_CHUNK_BYTES, size: state.size, status: 'downloading',
  }));
  const pausing = manager.pause(id);
  hold = false; pending.forEach(release => release());
  await pausing;
  expect(manager.snapshot()[0]).toMatchObject({ status: 'paused', received: FILE_CHUNK_BYTES });
  state.replace(); state.files.mockClear();
  await manager.resume(id);
  await vi.waitFor(() => expect(manager.snapshot()[0]).toMatchObject({
    status: 'ready', received: state.size, size: state.size,
  }));
  expect(state.files.mock.calls.find(([, request]) => request.type === 'readChunk')?.[1])
    .toMatchObject({ offset: 0 });
  const content = Buffer.concat([...storage.chunks.values()].map(data => Buffer.from(data, 'base64')));
  expect(content.equals(Buffer.alloc(state.size, 0x42))).toBe(true);
  expect(storage.tasks.get(id)?.status).toBe('ready');
  expect(state.unused).not.toHaveBeenCalled();
});

it('marks truncated SSH reads as failed instead of presenting a completed file', async () => {
  const state = fixture();
  const original = state.files.getMockImplementation()!;
  state.files.mockImplementation(async (id, request) => request.type === 'readChunk'
    ? { type: 'file', data: 'QQ==' } : original(id, request));
  const manager = new WebDownloadManager(); manager.register(state.connection);
  const id = await manager.enqueue(state.source);
  await vi.waitFor(() => expect(manager.snapshot()[0].status).toBe('failed'));
  expect(manager.snapshot()[0].received).toBe(0);
  expect(manager.retryAttempt(id)).toBe(0);
  expect(storage.tasks.get(id)?.status).toBe('failed');
});
