import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRelease } from './appUpdate';

const native = vi.hoisted(() => ({
  stored: null as string | null,
  getItem: vi.fn(), setItem: vi.fn(), deleteItem: vi.fn(),
  exists: vi.fn(), stat: vi.fn(), fetch: vi.fn(), config: vi.fn(), status: vi.fn(),
  modules: {} as Record<string, unknown>,
}));
vi.mock('expo-application', () => ({ nativeApplicationVersion: '1.5.29', nativeBuildVersion: '10502999' }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: native.getItem, setItemAsync: native.setItem, deleteItemAsync: native.deleteItem,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, NativeModules: native.modules }));
vi.mock('react-native-blob-util', () => ({ default: {
  fs: { exists: native.exists, stat: native.stat, dirs: { DownloadDir: '/storage/emulated/0/Download' } },
  config: native.config,
} }));

const stored = {
  version: '1.5.31', path: '/storage/emulated/0/Download/CodexSwitch-update-1.5.31-123.apk', expectedSize: 100,
};
const release: AppRelease = {
  version: stored.version, tagName: 'v1.5.31', title: 'Remote AI', notes: '', publishedAt: null,
  releaseUrl: 'https://example.com/release',
  androidAsset: { name: 'android.apk', downloadUrl: 'https://example.com/update.apk', size: stored.expectedSize },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  native.stored = JSON.stringify(stored);
  native.getItem.mockImplementation(async () => native.stored);
  native.setItem.mockImplementation(async (_key: string, value: string) => { native.stored = value; });
  native.deleteItem.mockImplementation(async () => { native.stored = null; });
  native.exists.mockResolvedValue(false);
  native.stat.mockResolvedValue({ size: stored.expectedSize });
  native.status.mockResolvedValue('missing');
  native.modules.AppUpdate = { getDownloadStatus: native.status };
  native.config.mockReturnValue({ fetch: native.fetch });
  native.fetch.mockResolvedValue({ path: () => stored.path });
});

describe('Android update recovery after restarting the app', () => {
  it.each(['failed', 'missing'])('allows retry when the system task is %s', async (status) => {
    native.status.mockResolvedValue(status);
    const update = await import('./appUpdate');
    expect(await update.refreshAndroidUpdateDownloadState()).toMatchObject({ status: 'failed', version: stored.version });
    expect(native.status).toHaveBeenCalledWith(stored.path);
    await update.startAndroidUpdateDownload(release);
    expect(native.fetch).toHaveBeenCalledWith('GET', release.androidAsset?.downloadUrl);
    expect(update.getAndroidUpdateDownloadState().status).toBe('downloaded');
  });

  it.each(['pending', 'running', 'paused'])('preserves a real %s background download', async (status) => {
    native.status.mockResolvedValue(status);
    const update = await import('./appUpdate');
    expect(await update.refreshAndroidUpdateDownloadState()).toEqual({ status: 'downloading', version: stored.version });
    expect(native.fetch).not.toHaveBeenCalled();
    expect(native.deleteItem).not.toHaveBeenCalled();
  });

  it('detects a background failure on the next refresh', async () => {
    native.status.mockResolvedValueOnce('running').mockResolvedValue('failed');
    const update = await import('./appUpdate');
    expect((await update.refreshAndroidUpdateDownloadState()).status).toBe('downloading');
    expect((await update.refreshAndroidUpdateDownloadState()).status).toBe('failed');
  });

  it.each(['successful', 'missing'])('restores a complete APK when the task is %s', async (status) => {
    native.status.mockResolvedValue(status);
    native.exists.mockResolvedValue(true);
    const update = await import('./appUpdate');
    expect(await update.refreshAndroidUpdateDownloadState()).toEqual({
      status: 'downloaded', version: stored.version, path: stored.path,
    });
  });

  it('does not offer an incomplete APK for installation', async () => {
    native.status.mockResolvedValue('successful');
    native.exists.mockResolvedValue(true);
    native.stat.mockResolvedValue({ size: 40 });
    const update = await import('./appUpdate');
    expect((await update.refreshAndroidUpdateDownloadState()).status).toBe('failed');
  });

  it.each(['missing', 'running', 'successful'])('requires system completion when size is unknown: %s', async (status) => {
    native.stored = JSON.stringify({ ...stored, expectedSize: 0 });
    native.status.mockResolvedValue(status);
    native.exists.mockResolvedValue(true);
    const update = await import('./appUpdate');
    const expected = { missing: 'failed', running: 'downloading', successful: 'downloaded' }[status];
    expect((await update.refreshAndroidUpdateDownloadState()).status).toBe(expected);
  });

  it.each(['query', 'file'])('allows retry when the %s check fails', async (check) => {
    if (check === 'query') native.status.mockRejectedValue(new Error('system query unavailable'));
    else native.exists.mockRejectedValue(new Error('file unavailable'));
    const update = await import('./appUpdate');
    expect((await update.refreshAndroidUpdateDownloadState()).status).toBe('failed');
  });

  it('allows retry in an older build without the status module', async () => {
    delete native.modules.AppUpdate;
    const update = await import('./appUpdate');
    expect((await update.refreshAndroidUpdateDownloadState()).status).toBe('failed');
  });

  it.each([null, 'not json', 'null', '{"version":"1.5.31"}'])('ignores invalid stored metadata: %s', async (value) => {
    native.stored = value;
    const update = await import('./appUpdate');
    expect((await update.refreshAndroidUpdateDownloadState()).status).toBe('idle');
  });

  it('clears metadata after the update has been installed', async () => {
    native.stored = JSON.stringify({ ...stored, version: '1.5.29' });
    const update = await import('./appUpdate');
    expect((await update.refreshAndroidUpdateDownloadState()).status).toBe('idle');
    expect(native.stored).toBeNull();
  });
});

describe('Android update refresh and retry races', () => {
  it('does not restore or install an APK when native integrity or signing checks fail', async () => {
    const verify = vi.fn().mockResolvedValue(false);
    native.modules.AppUpdate = { getDownloadStatus: native.status, verifyPackage: verify };
    native.exists.mockResolvedValue(true);
    native.status.mockResolvedValue('successful');
    const update = await import('./appUpdate');
    expect((await update.refreshAndroidUpdateDownloadState()).status).toBe('failed');
    await expect(update.installDownloadedAndroidUpdate(stored.path)).rejects.toThrow();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('shares one recovery query across the about page and global install prompt', async () => {
    const query = deferred<string>();
    native.status.mockReturnValue(query.promise);
    const update = await import('./appUpdate');
    const first = update.refreshAndroidUpdateDownloadState();
    const second = update.refreshAndroidUpdateDownloadState();
    expect(first).toBe(second);
    query.resolve('failed');
    await first;
    expect(native.status).toHaveBeenCalledTimes(1);
  });

  it('does not let stale recovery replace the state of a new download', async () => {
    const query = deferred<string>();
    native.status.mockReturnValue(query.promise);
    const update = await import('./appUpdate');
    const refresh = update.refreshAndroidUpdateDownloadState();
    const download = update.startAndroidUpdateDownload(release);
    query.resolve('failed');
    await refresh;
    expect(update.getAndroidUpdateDownloadState().status).toBe('downloading');
    await download;
    expect(update.getAndroidUpdateDownloadState().status).toBe('downloaded');
  });

  it('allows another attempt after a live download fails and preserves the failure when revisiting', async () => {
    native.fetch.mockRejectedValueOnce(new Error('network failure'));
    const update = await import('./appUpdate');
    await expect(update.startAndroidUpdateDownload(release)).rejects.toThrow('network failure');
    expect(native.stored).toBeNull();
    expect((await update.refreshAndroidUpdateDownloadState()).status).toBe('failed');
    await update.startAndroidUpdateDownload(release);
    expect(native.fetch).toHaveBeenCalledTimes(2);
    expect(update.getAndroidUpdateDownloadState().status).toBe('downloaded');
  });
});
