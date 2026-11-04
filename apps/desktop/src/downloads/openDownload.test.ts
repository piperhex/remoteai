import { afterEach, expect, it, vi } from 'vitest';
import { openDesktopDownload } from './openDownload';
import type { DownloadTask } from '../../../../shared/downloads/types';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(), verified: vi.fn(), browser: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: mocks.isTauri }));
vi.mock('../../../../shared/downloads/openDownload', () => ({
  verifiedDownloadContent: mocks.verified, openBrowserDownload: mocks.browser,
}));
const task = { id: 'download', name: 'sample.msi' } as DownloadTask;
afterEach(() => vi.resetAllMocks());

it('verifies cached content and writes bounded chunks before opening through the OS', async () => {
  mocks.isTauri.mockReturnValue(true);
  mocks.verified.mockResolvedValue(new Blob([new Uint8Array(300_000).fill(65)]));
  mocks.invoke.mockResolvedValue('temporary-id');
  await openDesktopDownload(task);
  expect(mocks.verified).toHaveBeenCalledWith(task);
  const requests = mocks.invoke.mock.calls.map(([, args]) => args.request);
  expect(requests.map(request => request.action)).toEqual(['begin', 'write', 'write', 'open']);
  expect(requests[0]).toEqual({ action: 'begin', name: 'sample.msi', size: 300_000 });
  expect(requests.slice(1, 3).map(request => atob(request.data).length)).toEqual([262_144, 37_856]);
  expect(requests.at(-1)).toEqual({ action: 'open', id: 'temporary-id' });
});

it('removes incomplete temporary output when writing fails and never opens it', async () => {
  mocks.isTauri.mockReturnValue(true);
  mocks.verified.mockResolvedValue(new Blob(['file']));
  mocks.invoke.mockResolvedValueOnce('temporary-id').mockRejectedValueOnce(new Error('full')).mockResolvedValue(null);
  await expect(openDesktopDownload(task)).rejects.toThrow('full');
  expect(mocks.invoke.mock.calls.map(([, args]) => args.request.action)).toEqual(['begin', 'write', 'cancel']);
});

it('does not create a local file after failed verification and uses browser behavior outside Tauri', async () => {
  mocks.isTauri.mockReturnValue(true);
  mocks.verified.mockRejectedValue(new Error('corrupt'));
  await expect(openDesktopDownload(task)).rejects.toThrow('corrupt');
  expect(mocks.invoke).not.toHaveBeenCalled();
  mocks.isTauri.mockReturnValue(false);
  await openDesktopDownload(task);
  expect(mocks.browser).toHaveBeenCalledWith(task);
});
