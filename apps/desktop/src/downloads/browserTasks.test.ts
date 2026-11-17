// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { WebDownloadManager } from '../../../../shared/downloads/manager';
import { registerBrowserDownloads } from '../../../../shared/downloads/browserTasks';
import type { DownloadTask } from '../../../../shared/downloads/types';

const storage = vi.hoisted(() => ({ list: vi.fn(async (): Promise<DownloadTask[]> => []),
  store: vi.fn(async () => {}), remove: vi.fn(async () => {}) }));
vi.mock('../../../../shared/downloads/storage', () => ({
  listDownloads: storage.list, storeDownload: storage.store, deleteDownload: storage.remove,
}));
const task = (id: string): DownloadTask => ({ id, name: 'zcMobile.apk',
  source: { owner: 'desktop-local', deviceId: 'local', deviceName: 'http://lan.test',
    path: 'zcMobile.apk', scope: 'computer' }, status: 'paused', received: 0, size: 100,
  createdAt: 1, message: '', browser: { id, awaitingConfirmation: true, canResume: true } });
afterEach(() => vi.clearAllMocks());

it('keeps each insecure download independently and delegates cancellation without fetching it again', async () => {
  const control = vi.fn(async () => {});
  const unregister = registerBrowserDownloads(control);
  try {
    const manager = new WebDownloadManager();
    await manager.updateBrowser(task('first')); await manager.updateBrowser(task('second'));
    await manager.resume('first');
    expect(control.mock.calls).toEqual([['first', 'resume']]);
    expect(manager.snapshot().find(value => value.id === 'second')?.browser?.awaitingConfirmation).toBe(true);
    await manager.remove('second');
    expect(control.mock.calls).toEqual([['first', 'resume'], ['second', 'remove']]);
    expect(storage.remove).toHaveBeenCalledWith('second');
    expect(manager.snapshot().map(value => value.id)).toEqual(['first']);
  } finally { unregister(); }
});

it('restores completed records but disables stale confirmations and resume after a restart', async () => {
  storage.list.mockResolvedValueOnce([task('pending'), { ...task('finished'), status: 'completed' }]);
  const manager = new WebDownloadManager(); await manager.initialize();
  expect(manager.snapshot()[0]).toMatchObject({ status: 'failed',
    browser: { awaitingConfirmation: false, canResume: false } });
  expect(manager.snapshot()[1].status).toBe('completed');
});

it('does not resume a native transfer through the remote file scheduler when a connection changes', async () => {
  const manager = new WebDownloadManager();
  const transfer = { ...task('native'), status: 'queued' as const };
  const control = vi.fn(async () => {});
  const unregister = registerBrowserDownloads(control);
  try {
    await manager.updateBrowser(transfer);
    const fail = vi.fn(async (): Promise<never> => { throw new Error('Native transfer was refetched'); });
    manager.register({ owner: 'desktop-local', deviceId: 'local', deviceName: 'local', ready: true, mode: 'direct',
      files: { open: fail, read: fail, close: fail }, client: { open: fail, read: fail, close: fail, browse: fail } });
    await Promise.resolve();
    expect(fail).not.toHaveBeenCalled();
    expect(manager.snapshot()[0].status).toBe('queued');
  } finally { unregister(); }
});
