import { beforeEach, expect, it, vi } from 'vitest';
import type { BrowserDownloadSnapshot } from './browserDownloads';
import type { BrowserDownloadAction } from '../../../../shared/downloads/browserTasks';
import type { DownloadTask } from '../../../../shared/downloads/types';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), update: vi.fn(async (_task: DownloadTask) => {}), unlisten: vi.fn(),
  unregister: vi.fn(), listener: undefined as undefined | ((event: { payload: BrowserDownloadSnapshot }) => void),
  control: undefined as undefined | ((id: string, action: BrowserDownloadAction) => Promise<void>) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_name, listener) => {
  mocks.listener = listener; return mocks.unlisten;
}) }));
vi.mock('../../../../shared/downloads/manager', () => ({ downloadManager: {
  updateBrowser: mocks.update, snapshot: () => [],
} }));
vi.mock('../../../../shared/downloads/browserTasks', () => ({ registerBrowserDownloads: vi.fn(control => {
  mocks.control = control; return mocks.unregister;
}) }));
vi.mock('./localGitDownloads', () => ({ LOCAL_DOWNLOAD_OWNER: 'desktop-local' }));
import { connectBrowserDownloads } from './browserDownloads';

const snapshot = (sequence: number): BrowserDownloadSnapshot => ({ id: 'native', name: 'file.apk',
  origin: 'http://lan.test', createdAt: 1, status: 'downloading', received: sequence * 100, size: 1000,
  awaitingConfirmation: false, canResume: true, sequence });
beforeEach(() => { vi.clearAllMocks(); mocks.invoke.mockResolvedValue([]); mocks.update.mockResolvedValue(); });

it('ignores a stale startup snapshot when a newer native progress event arrived first', async () => {
  mocks.invoke.mockImplementationOnce(async () => {
    mocks.listener!({ payload: snapshot(3) }); return [snapshot(1)];
  });
  const stop = await connectBrowserDownloads(vi.fn());
  await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
  expect(mocks.update.mock.calls[0][0]).toMatchObject({ received: 300, status: 'downloading' });
  stop(); expect(mocks.unlisten).toHaveBeenCalled(); expect(mocks.unregister).toHaveBeenCalled();
});

it('ignores queued and late progress after the user removes a download', async () => {
  const stop = await connectBrowserDownloads(vi.fn());
  mocks.listener!({ payload: snapshot(1) });
  await mocks.control!('native', 'remove');
  mocks.listener!({ payload: snapshot(2) });
  await Promise.resolve(); await Promise.resolve();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith('browser_download_action', { id: 'native', action: 'remove' });
  stop();
});

it('cancels an untracked native transfer if storing its task fails', async () => {
  mocks.update.mockRejectedValueOnce(new Error('Storage full'));
  const stop = await connectBrowserDownloads(vi.fn());
  mocks.listener!({ payload: snapshot(1) });
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('browser_download_action',
    { id: 'native', action: 'remove' }));
  stop();
});
