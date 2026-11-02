import { afterEach, expect, it, vi } from 'vitest';
import { getLatestAndroidApkUrl } from './releaseDownloads';

const asset = (name: string) => ({
  name, browser_download_url: `https://github.com/piperhex/remoteai/releases/download/v2.1.13/${name}`,
});

afterEach(() => vi.unstubAllGlobals());

it.each(['RemoteAI', 'CodexSwitch'])('finds the %s Android release from admin', async brand => {
  const apk = asset(`${brand}-android-v2.1.13.apk`);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assets: [apk] }) }));
  expect(await getLatestAndroidApkUrl()).toBe(apk.browser_download_url);
});

it('prefers the renamed APK over the legacy asset and ignores incomplete assets', async () => {
  const apk = asset('RemoteAI-android-v2.1.13.apk');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assets: [
    null, { name: apk.name }, asset('CodexSwitch-android-v2.1.13.apk'), apk,
  ] }) }));
  expect(await getLatestAndroidApkUrl()).toBe(apk.browser_download_url);
});

it('reports releases without a downloadable Android installer', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    assets: [asset('RemoteAI-ios-unsigned.app.zip')],
  }) }));
  await expect(getLatestAndroidApkUrl()).rejects.toThrow('does not contain an APK');
});
