// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { WebDownloadManager } from '../../../../shared/downloads/manager';
import type { DownloadTask } from '../../../../shared/downloads/types';
import { loungeDownloadClient, LOUNGE_DOWNLOAD_DEVICE } from '../../../../shared/lounge/downloadClient';
import type { LoungeAttachmentManager } from '../../../../shared/lounge/attachmentManager';
import type { LoungeAttachment } from '../../../../shared/lounge/attachments';

const storage = vi.hoisted(() => ({ tasks: new Map<string, DownloadTask>(), chunks: new Map<number, string>() }));
vi.mock('../../../../shared/downloads/storage', () => ({
  listDownloads: async () => [],
  storeDownload: async (task: DownloadTask) => { storage.tasks.set(task.id, structuredClone(task)); },
  resetDownload: async () => { storage.chunks.clear(); },
  storeChunk: async (_task: DownloadTask, offset: number, data: string) => { storage.chunks.set(offset, data); },
}));

it('downloads lounge files alongside computer connections and refreshes reconnect actions', async () => {
  const file: LoungeAttachment = { id: '10000000-0000-4000-8000-000000000001',
    device: '10000000-0000-4000-8000-000000000002', name: 'report.pdf', mime: 'application/pdf',
    size: 700001, kind: 'file', grant: 'signed' };
  const bytes = Buffer.alloc(file.size, 149);
  const reader = { read: vi.fn(async (offset: number, length: number) =>
    bytes.subarray(offset, offset + length).toString('base64')), close: vi.fn() };
  const client = loungeDownloadClient({ openReader: async () => reader } as unknown as LoungeAttachmentManager);
  const manager = new WebDownloadManager();
  const computerFiles = { open: vi.fn(), read: vi.fn(), close: vi.fn() };
  const computer = { owner: 'alice', deviceId: 'pc', deviceName: 'PC', ready: true, mode: 'direct' as const,
    files: computerFiles, client: { ...computerFiles, browse: vi.fn() } };
  manager.register(computer);
  const lounge = { owner: 'alice', deviceId: LOUNGE_DOWNLOAD_DEVICE, deviceName: 'Lounge',
    ready: true, mode: 'relay' as const, client };
  manager.registerLounge(lounge);
  const source = { owner: 'alice', deviceId: LOUNGE_DOWNLOAD_DEVICE, deviceName: 'Lounge',
    scope: 'computer' as const, path: file.name, attachment: file };
  const id = await manager.enqueue(source);
  await vi.waitFor(() => expect(storage.tasks.get(id)?.status).toBe('ready'));
  expect(Buffer.concat([...storage.chunks.entries()].sort(([a], [b]) => a - b)
    .map(([, data]) => Buffer.from(data, 'base64')))).toEqual(bytes);
  expect(storage.tasks.get(id)?.source.attachment).toEqual(file);
  expect(reader.close).toHaveBeenCalledOnce();
  expect(computerFiles.open).not.toHaveBeenCalled();
  expect(manager.connection()).toBe(computer);
  const beforeDisconnect = manager.snapshot();
  manager.unbindLounge('alice');
  expect(manager.snapshot()).not.toBe(beforeDisconnect);
  expect(manager.connectionForSource(source)).toBeUndefined();
  const beforeReconnect = manager.snapshot();
  manager.registerLounge(lounge);
  expect(manager.snapshot()).not.toBe(beforeReconnect);
  expect(manager.connectionForSource(source)?.ready).toBe(true);
  expect(manager.connectionForSource({ ...source, owner: 'bob' })).toBeUndefined();
});
