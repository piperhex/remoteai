import { beforeEach, expect, it, vi } from 'vitest';
import { downloadSharedAndroidUpdate, downloadOfficialAndroidUpdate } from './androidSharedDownload';
import type { AppRelease } from './appUpdate';

const state = vi.hoisted(() => ({ artifact: vi.fn(), peers: vi.fn(), official: vi.fn(),
  find: vi.fn(), close: vi.fn(), load: vi.fn(), profile: vi.fn() }));
vi.mock('react-native', () => ({ NativeModules: { AppUpdate: {
  artifactId: state.artifact, downloadPeers: state.peers, downloadOfficial: state.official,
} } }));
vi.mock('../api/client', () => ({ loadSession: state.load, fetchUserProfile: state.profile }));
vi.mock('../../../../shared/app-update/peerLookup', () => ({ findUpdatePeers: state.find }));
const release = { version: '2.0.0', androidAsset: { name: 'android.apk', size: 123,
  downloadUrl: 'https://github.com/piperhex/remoteai/releases/download/v2.0.0/android.apk', sha256: 'a'.repeat(64),
} } as AppRelease;

beforeEach(() => {
  vi.resetAllMocks();
  state.load.mockResolvedValue({ baseUrl: 'https://example.test', accessToken: 'secret' });
  state.profile.mockResolvedValue({});
  state.artifact.mockResolvedValue('b'.repeat(64));
  state.find.mockResolvedValue({ configs: [{ sessionId: 'one' }, { sessionId: 'two' }], close: state.close });
  state.peers.mockResolvedValue('/update.apk');
});

it('passes all independent sources and the Wi-Fi policy to the native downloader', async () => {
  expect(await downloadSharedAndroidUpdate({ release, path: '/update.apk', wifiOnly: true })).toBe('/update.apk');
  const options = JSON.parse(state.peers.mock.calls[0][0]);
  expect(options.configs).toHaveLength(2);
  expect(options.sha256).toBe(release.androidAsset?.sha256);
  expect(options.wifiOnly).toBe(true);
  expect(state.close).toHaveBeenCalledOnce();
});

it.each(['unavailable', 'tampered', 'disconnected'])('allows GitHub fallback after %s', async failure => {
  state.peers.mockRejectedValue(new Error(failure));
  const options = { release, path: '/update.apk', wifiOnly: true };
  expect(await downloadSharedAndroidUpdate(options)).toBeNull();
  state.official.mockResolvedValue('/update.apk');
  await downloadOfficialAndroidUpdate(options);
  expect(JSON.parse(state.official.mock.calls[0][0])).toMatchObject({ wifiOnly: true,
    url: release.androidAsset?.downloadUrl });
  expect(state.close).toHaveBeenCalledOnce();
});

it('never requests peer bytes without an authoritative hash', async () => {
  const unsigned = { ...release, androidAsset: { ...release.androidAsset!, sha256: undefined } };
  expect(await downloadSharedAndroidUpdate({ release: unsigned, path: '/x', wifiOnly: false })).toBeNull();
  expect(state.find).not.toHaveBeenCalled();
});
