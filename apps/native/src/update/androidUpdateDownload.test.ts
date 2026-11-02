import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRelease } from './appUpdate';

const native = vi.hoisted(() => ({
  stored: null as string | null,
  getItem: vi.fn(), setItem: vi.fn(), deleteItem: vi.fn(),
  exists: vi.fn(), stat: vi.fn(), fetch: vi.fn(), config: vi.fn(), status: vi.fn(),
  modules: {} as Record<string, unknown>,
  listen: vi.fn(), remove: vi.fn(),
  report: vi.fn(), session: vi.fn(), peers: vi.fn(),
}));
vi.mock('expo-application', () => ({ nativeApplicationVersion: '1.5.29', nativeBuildVersion: '10502999' }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: native.getItem, setItemAsync: native.setItem, deleteItemAsync: native.deleteItem,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, NativeModules: native.modules,
  DeviceEventEmitter: { addListener: native.listen } }));
vi.mock('./androidUpdateNotifications', () => ({ prepareUpdateNotifications: vi.fn(),
  updateNotificationLabels: () => ({}) }));
vi.mock('../api/client', () => ({ loadSession: native.session }));
vi.mock('../../../../shared/app-update/peerLookup', () => ({ findUpdatePeers: native.peers }));
vi.mock('../../../../shared/app-update/downloadReport', () => ({ reportDownload: native.report }));
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
  native.listen.mockReturnValue({ remove: native.remove });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Android update checks after the release rename', () => {
  it.each(['RemoteAI', 'CodexSwitch'])('checks and preserves the %s APK download metadata', async brand => {
    const name = `${brand}-android-v2.1.13.apk`;
    const url = `https://github.com/piperhex/remoteai/releases/download/v2.1.13/${name}`;
    const sha256 = 'a'.repeat(64);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      tag_name: 'v2.1.13', html_url: 'https://github.com/piperhex/remoteai/releases/tag/v2.1.13',
      assets: [{ name, browser_download_url: url, size: 100, digest: `sha256:${sha256}` }],
    }) }));
    const update = await import('./appUpdate');
    const result = await update.checkForAppUpdate();
    expect(result.updateAvailable).toBe(true);
    expect(result.release.version).toBe('2.1.13');
    expect(result.release.androidAsset).toEqual({ name, downloadUrl: url, size: 100, sha256 });
  });
});

describe('Android update recovery after restarting the app', () => {
  it('restores system download bytes after restart, updates speed, and offers the completed APK', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    native.status.mockResolvedValue('running');
    const snapshot = vi.fn().mockResolvedValue({ status: 'running', receivedBytes: 40, totalBytes: 100 });
    const verify = vi.fn().mockResolvedValue(true);
    native.modules.AppUpdate = { getDownloadSnapshot: snapshot, getDownloadStatus: native.status,
      verifyPackage: verify };
    const update = await import('./appUpdate');
    const listener = vi.fn();
    const unsubscribe = update.subscribeAndroidUpdateDownload(listener);
    expect(await update.refreshAndroidUpdateDownloadState()).toEqual({
      status: 'downloading', version: stored.version,
      progress: { receivedBytes: 40, totalBytes: 100, bytesPerSecond: 0, phase: 'downloading' },
    });
    vi.setSystemTime(15_000);
    snapshot.mockResolvedValue({ status: 'running', receivedBytes: 70, totalBytes: 100 });
    await update.refreshAndroidUpdateDownloadState();
    expect(listener).toHaveBeenLastCalledWith({
      status: 'downloading', version: stored.version,
      progress: { receivedBytes: 70, totalBytes: 100, bytesPerSecond: 6, phase: 'downloading' },
    });
    snapshot.mockResolvedValue({ status: 'successful', receivedBytes: 100, totalBytes: 100 });
    native.exists.mockResolvedValue(true);
    expect(await update.refreshAndroidUpdateDownloadState()).toEqual({
      status: 'downloaded', version: stored.version, path: stored.path,
    });
    expect(verify).toHaveBeenCalledOnce();
    expect(snapshot).toHaveBeenCalledWith(stored.path);
    expect(native.status).not.toHaveBeenCalled();
    expect(native.fetch).not.toHaveBeenCalled();
    expect(native.deleteItem).not.toHaveBeenCalled();
    unsubscribe();
  });

  it.each(['pending', 'running', 'paused'])('retains progress for a restored %s download', async status => {
    native.status.mockResolvedValue(status);
    const snapshot = vi.fn().mockResolvedValue({ status, receivedBytes: 40, totalBytes: 0 });
    native.modules.AppUpdate = { getDownloadSnapshot: snapshot };
    const update = await import('./appUpdate');
    expect(await update.refreshAndroidUpdateDownloadState()).toEqual({
      status: 'downloading', version: stored.version,
      progress: { receivedBytes: 40, totalBytes: stored.expectedSize, bytesPerSecond: 0, phase: 'downloading' },
    });
    expect(native.fetch).not.toHaveBeenCalled();
    expect(native.deleteItem).not.toHaveBeenCalled();
  });

  it.each(['success', 'transfer-failed', 'verify-failed'])(
    'settles one report only after the official fallback and verification: %s', async outcome => {
      const transfer = deferred<string>();
      const official = vi.fn().mockReturnValue(transfer.promise);
      const report = { id: 'same-report', artifact: 'b'.repeat(64), platform: 'android', outcome: 'failed',
        peerBytes: 0, serverBytes: 0, originBytes: 0,
        failures: [{ source: 'peer', stage: 'connect', code: 'unavailable', count: 3 }] };
      const session = { baseUrl: 'https://example.test', accessToken: 'original-account' };
      native.session.mockResolvedValue(session);
      native.peers.mockResolvedValue({ configs: [], close: vi.fn() });
      native.modules.AppUpdate = { artifactId: vi.fn().mockResolvedValue(report.artifact),
        downloadPeers: vi.fn(), updatePath: () => Promise.resolve(stored.path),
        downloadPeersReported: vi.fn().mockResolvedValue(JSON.stringify({ path: null, report })),
        downloadOfficial: official,
        verifyPackage: vi.fn().mockResolvedValue(outcome !== 'verify-failed') };
      const update = await import('./appUpdate');
      const signed = { ...release, androidAsset: { ...release.androidAsset!, sha256: 'a'.repeat(64) } };
      const download = update.startAndroidUpdateDownload(signed);
      const settled = download.then(() => true, () => false);
      await vi.waitFor(() => expect(official).toHaveBeenCalledOnce());
      expect(native.report).not.toHaveBeenCalled();
      native.session.mockResolvedValue({ ...session, accessToken: 'different-account' });
      if (outcome === 'transfer-failed') transfer.reject(new Error('private network details'));
      else transfer.resolve(stored.path);
      expect(await settled).toBe(outcome === 'success');
      expect(native.report).toHaveBeenCalledOnce();
      expect(native.report).toHaveBeenCalledWith(session, expect.objectContaining({
        id: 'same-report', outcome: outcome === 'success' ? 'success' : 'failed',
        originBytes: outcome === 'success' ? stored.expectedSize : 0,
      }));
      expect(JSON.stringify(native.report.mock.calls)).not.toContain('private network details');
    },
  );
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
  it('shares live bytes and speed across page visits and cleans up after verification', async () => {
    const transfer = deferred<string>();
    const official = vi.fn().mockReturnValue(transfer.promise);
    native.modules.AppUpdate = { downloadOfficial: official, updatePath: () => Promise.resolve(stored.path) };
    const update = await import('./appUpdate');
    const download = update.startAndroidUpdateDownload(release);
    await vi.waitFor(() => expect(official).toHaveBeenCalledOnce());
    const event = native.listen.mock.calls.find(([name]) => name === 'appUpdateDownloadProgress')![1];
    const progress = { receivedBytes: 40, totalBytes: 100, bytesPerSecond: 20, phase: 'downloading' };
    event({ ...progress, path: '/unrelated.apk' });
    expect(update.getAndroidUpdateDownloadState()).toMatchObject({ progress: { receivedBytes: 0 } });
    event({ ...progress, path: stored.path });
    const revisited = vi.fn();
    const unsubscribe = update.subscribeAndroidUpdateDownload(revisited);
    expect(await update.refreshAndroidUpdateDownloadState()).toMatchObject({ status: 'downloading', progress });
    event({ ...progress, receivedBytes: 100, phase: 'verifying', bytesPerSecond: 0, path: stored.path });
    expect(revisited).toHaveBeenLastCalledWith(expect.objectContaining({
      progress: expect.objectContaining({ phase: 'verifying', bytesPerSecond: 0 }),
    }));
    transfer.resolve(stored.path);
    await download;
    expect(update.getAndroidUpdateDownloadState().status).toBe('downloaded');
    expect(native.remove).toHaveBeenCalledOnce();
    unsubscribe();
  });

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
    expect(native.remove).toHaveBeenCalledOnce();
    expect((await update.refreshAndroidUpdateDownloadState()).status).toBe('failed');
    await update.startAndroidUpdateDownload(release);
    expect(native.fetch).toHaveBeenCalledTimes(2);
    expect(update.getAndroidUpdateDownloadState().status).toBe('downloaded');
  });
});
