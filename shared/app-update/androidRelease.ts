const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const CURRENT_ANDROID_NAME = /^RemoteAI-android-.+\.apk$/i;
const LEGACY_ANDROID_NAME = /^CodexSwitch-android-.+\.apk$/i;

export interface AndroidReleaseAssetMetadata {
  name: string;
  browser_download_url: string;
  size?: unknown;
  digest?: unknown;
  content_type?: unknown;
}

function isDownloadableApk(value: unknown): value is AndroidReleaseAssetMetadata {
  if (!value || typeof value !== 'object') return false;
  const asset = value as Partial<AndroidReleaseAssetMetadata>;
  return typeof asset.name === 'string' && /\.apk$/i.test(asset.name)
    && typeof asset.browser_download_url === 'string' && asset.browser_download_url.trim().length > 0;
}

/** Keep older releases installable while preferring the current product name during a rename. */
export function findAndroidReleaseAsset(value: unknown): AndroidReleaseAssetMetadata | undefined {
  if (!Array.isArray(value)) return undefined;
  const assets = value.filter(isDownloadableApk);
  return assets.find(asset => CURRENT_ANDROID_NAME.test(asset.name))
    ?? assets.find(asset => LEGACY_ANDROID_NAME.test(asset.name))
    ?? assets.find(asset => /android/i.test(asset.name) || asset.content_type === APK_MIME_TYPE);
}
