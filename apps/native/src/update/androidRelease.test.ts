import { describe, expect, it } from 'vitest';
import { findAndroidReleaseAsset } from '../../../../shared/app-update/androidRelease';
import { updateMirrorUrl } from '../../../../shared/app-update/mirrorUrl';
import { versionFromReleaseMetadata } from '../../../../shared/app-update/version';

const currentName = 'RemoteAI-android-v2.1.13.apk';
const legacyName = 'CodexSwitch-android-v2.1.12.apk';
const releaseUrl = 'https://github.com/piperhex/remoteai/releases/download/v2.1.13/';
const asset = (name: string) => ({ name, browser_download_url: `${releaseUrl}${name}` });

describe('Android release assets shared by native, desktop and admin', () => {
  it.each([currentName, legacyName])('recognizes %s and preserves its mirror path', name => {
    const selected = findAndroidReleaseAsset([asset(name)]);
    expect(selected).toEqual(asset(name));
    expect(updateMirrorUrl('https://example.test/api', selected!.browser_download_url))
      .toBe(`https://example.test/api/update-packages/v2.1.13/${name}`);
  });

  it('prefers the new name regardless of release asset order', () => {
    const assets = [asset(legacyName), asset(currentName)];
    expect(findAndroidReleaseAsset(assets)?.name).toBe(currentName);
    expect(findAndroidReleaseAsset([...assets].reverse())?.name).toBe(currentName);
  });

  it('skips missing URLs and non-APK files while retaining legacy compatibility', () => {
    expect(findAndroidReleaseAsset([
      null, {}, { name: currentName }, { ...asset(currentName), browser_download_url: ' ' },
      asset(`${currentName}.sig`), asset('RemoteAI-ios-unsigned.app.zip'), asset(legacyName),
    ])?.name).toBe(legacyName);
  });

  it('retains generic Android and APK content-type fallback', () => {
    expect(findAndroidReleaseAsset([asset('android.apk')])?.name).toBe('android.apk');
    const generic = { ...asset('app.apk'), content_type: 'application/vnd.android.package-archive' };
    expect(findAndroidReleaseAsset([generic])).toEqual(generic);
  });

  it.each([undefined, null, {}, [], [asset('RemoteAI-ios-unsigned.app.zip')]])
  ('returns no installer for invalid or non-Android metadata: %j', value => {
    expect(findAndroidReleaseAsset(value)).toBeUndefined();
  });

  it.each([[currentName, '2.1.13'], [legacyName, '2.1.12']])
  ('recovers the version from %s when tag and title are unavailable', (name, version) => {
    expect(versionFromReleaseMetadata(['untagged-123', 'Remote AI', name])).toBe(version);
  });
});
