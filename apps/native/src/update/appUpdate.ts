import { t } from '../i18n';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import appConfig from '../../app.json';
import { getAndroidDownloadStatus } from './androidDownloadStatus';
import { downloadSharedAndroidUpdate, downloadOfficialAndroidUpdate,
  nativeUpdatePath, verifyAndroidPackage } from './androidSharedDownload';
import { compareAppVersions, versionFromReleaseMetadata } from '../../../../shared/app-update/version';

export { compareAppVersions } from '../../../../shared/app-update/version';
export { versionFromReleaseMetadata } from './version';

const RELEASE_API_URL = 'https://api.github.com/repos/piperhex/remoteai/releases/latest';
const UPDATE_METADATA_KEY = 'codex-switch.mobile.android-update.v1';
const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const DOWNLOAD_RETRY_MESSAGE = '下载未完成，请重新下载。';

export const RELEASES_URL = 'https://github.com/piperhex/remoteai/releases';
export const CURRENT_APP_VERSION =
  Application.nativeApplicationVersion ?? appConfig.expo.version;
export const CURRENT_BUILD_VERSION =
  Application.nativeBuildVersion ?? String(appConfig.expo.android.versionCode ?? 1);

export interface AndroidReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
  sha256?: string;
}

export interface AppRelease {
  version: string;
  tagName: string;
  title: string;
  notes: string;
  publishedAt: string | null;
  releaseUrl: string;
  androidAsset: AndroidReleaseAsset | null;
}

export interface AppUpdateCheck {
  currentVersion: string;
  updateAvailable: boolean;
  release: AppRelease;
}

export type AndroidUpdateDownloadState =
  | { status: 'idle' }
  | { status: 'downloading'; version: string }
  | { status: 'downloaded'; version: string; path: string }
  | { status: 'failed'; version: string; message: string };

interface StoredAndroidUpdate {
  version: string;
  path: string;
  expectedSize: number;
  sha256?: string;
}

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  content_type?: unknown;
  digest?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

type DownloadListener = (state: AndroidUpdateDownloadState) => void;

let downloadState: AndroidUpdateDownloadState = { status: 'idle' };
let activeDownload: Promise<string> | null = null;
let stateRefresh: Promise<AndroidUpdateDownloadState> | null = null;
const downloadListeners = new Set<DownloadListener>();

function textValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function androidAssetFrom(value: unknown): AndroidReleaseAsset | null {
  if (!Array.isArray(value)) return null;
  const assets = value as GitHubReleaseAsset[];
  const asset = assets.find((candidate) => {
    const name = textValue(candidate.name);
    const contentType = textValue(candidate.content_type);
    return /\.apk$/i.test(name) && (/android/i.test(name) || contentType === APK_MIME_TYPE);
  });
  if (!asset) return null;
  const name = textValue(asset.name);
  const downloadUrl = textValue(asset.browser_download_url);
  if (!name || !downloadUrl) return null;
  const digest = textValue(asset.digest);
  const sha256 = /^sha256:[0-9a-f]{64}$/.test(digest) ? digest.slice(7) : undefined;
  return { name, downloadUrl, size: numberValue(asset.size), ...(sha256 ? { sha256 } : {}) };
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${RELEASE_API_URL}?t=${Date.now()}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'Cache-Control': 'no-cache',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      throw new Error(t("检查更新服务返回 HTTP {value1}", { value1: response.status }));
    }
    return await response.json() as GitHubRelease;
  } finally { clearTimeout(timer); }
}

export async function checkForAppUpdate(): Promise<AppUpdateCheck> {
  const payload = await fetchLatestRelease();
  const tagName = textValue(payload.tag_name);
  const assets = Array.isArray(payload.assets) ? payload.assets as GitHubReleaseAsset[] : [];
  const assetNames = assets.map((asset) => asset.name);
  const version = versionFromReleaseMetadata([tagName, payload.name, ...assetNames]);
  const releaseUrl = textValue(payload.html_url);
  if (!version || !releaseUrl) {
    throw new Error(t("最新版本信息格式无效"));
  }

  const release: AppRelease = {
    version,
    tagName,
    title: textValue(payload.name) || `Remote AI ${tagName}`,
    notes: textValue(payload.body),
    publishedAt: textValue(payload.published_at) || null,
    releaseUrl,
    androidAsset: androidAssetFrom(assets),
  };
  return {
    currentVersion: CURRENT_APP_VERSION,
    updateAvailable: compareAppVersions(version, CURRENT_APP_VERSION) > 0,
    release,
  };
}

function publishDownloadState(nextState: AndroidUpdateDownloadState) {
  downloadState = nextState;
  downloadListeners.forEach((listener) => listener(nextState));
}

export function getAndroidUpdateDownloadState() {
  return downloadState;
}

export function subscribeAndroidUpdateDownload(listener: DownloadListener) {
  downloadListeners.add(listener);
  return () => downloadListeners.delete(listener);
}

async function blobUtil() {
  try {
    return (await import('react-native-blob-util')).default;
  } catch {
    throw new Error(t("当前安装包不包含后台下载组件，请安装最新完整版本后重试"));
  }
}

async function readStoredAndroidUpdate(): Promise<StoredAndroidUpdate | null> {
  const stored = await SecureStore.getItemAsync(UPDATE_METADATA_KEY);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as Partial<StoredAndroidUpdate>;
    if (
      typeof value.version !== 'string'
      || typeof value.path !== 'string'
      || typeof value.expectedSize !== 'number'
      || !Number.isFinite(value.expectedSize)
    ) {
      return null;
    }
    return value as StoredAndroidUpdate;
  } catch {
    return null;
  }
}

async function storedUpdateIsComplete(stored: StoredAndroidUpdate, successful = false) {
  const util = await blobUtil();
  if (!await util.fs.exists(stored.path)) return false;
  const stat = await util.fs.stat(stored.path);
  const size = Number(stat.size);
  if (stored.expectedSize <= 0 ? !successful || size <= 0 : size !== stored.expectedSize) return false;
  return verifyAndroidPackage({ path: stored.path, size: stored.expectedSize, sha256: stored.sha256 });
}

async function restoreAndroidUpdateDownloadState(): Promise<AndroidUpdateDownloadState> {
  const stored = await readStoredAndroidUpdate();
  if (!stored) {
    return downloadState.status === 'failed' ? downloadState : { status: 'idle' };
  }
  if (compareAppVersions(stored.version, CURRENT_APP_VERSION) <= 0) {
    await SecureStore.deleteItemAsync(UPDATE_METADATA_KEY);
    return { status: 'idle' };
  }
  try {
    const status = await getAndroidDownloadStatus(stored.path);
    if (status === 'pending' || status === 'running' || status === 'paused') {
      return { status: 'downloading', version: stored.version };
    }
    if (status !== 'failed' && await storedUpdateIsComplete(stored, status === 'successful')) {
      return { status: 'downloaded', version: stored.version, path: stored.path };
    }
  } catch {
    // A failed status/file check must not leave the only download action disabled.
  }
  return { status: 'failed', version: stored.version, message: DOWNLOAD_RETRY_MESSAGE };
}

export function refreshAndroidUpdateDownloadState(): Promise<AndroidUpdateDownloadState> {
  if (Platform.OS !== 'android' || activeDownload) return Promise.resolve(downloadState);
  if (stateRefresh) return stateRefresh;
  const previousState = downloadState;
  stateRefresh = restoreAndroidUpdateDownloadState().then((nextState) => {
    // A new download may have started while storage or the system query was pending.
    if (!activeDownload && downloadState === previousState) publishDownloadState(nextState);
    return downloadState;
  }).finally(() => { stateRefresh = null; });
  return stateRefresh;
}

export async function startAndroidUpdateDownload(release: AppRelease, options: { wifiOnly?: boolean } = {}) {
  if (Platform.OS !== 'android') throw new Error(t("应用内安装目前仅支持 Android"));
  if (!release.androidAsset) throw new Error(t("该版本没有可用的 Android 安装包"));
  if (activeDownload) return activeDownload;
  const androidAsset = release.androidAsset;

  publishDownloadState({ status: 'downloading', version: release.version });
  activeDownload = (async () => {
    try {
      // Let recovery finish its storage cleanup before recording the new attempt.
      await stateRefresh;
      const util = await blobUtil();
      const safeVersion = release.version.replace(/[^0-9A-Za-z.-]/g, '-');
      const path = await nativeUpdatePath(safeVersion)
        ?? `${util.fs.dirs.DownloadDir}/CodexSwitch-update-${safeVersion}-${Date.now()}.apk`;
      const stored: StoredAndroidUpdate = {
        version: release.version,
        path,
        expectedSize: androidAsset.size,
        sha256: androidAsset.sha256,
      };
      await SecureStore.setItemAsync(UPDATE_METADATA_KEY, JSON.stringify(stored));
      const downloadedPath = await downloadAndroidPackage({ release, path, wifiOnly: options.wifiOnly === true });
      if (!await verifyAndroidPackage({ path: downloadedPath, size: androidAsset.size, sha256: androidAsset.sha256 })) {
        throw new Error(t("下载未完成，请重新下载。"));
      }
      const completed = { ...stored, path: downloadedPath };
      await SecureStore.setItemAsync(UPDATE_METADATA_KEY, JSON.stringify(completed));
      publishDownloadState({ status: 'downloaded', version: release.version, path: downloadedPath });
      return downloadedPath;
    } catch (error) {
      const message = t("下载未完成，请重新下载。");
      await SecureStore.deleteItemAsync(UPDATE_METADATA_KEY).catch(() => undefined);
      publishDownloadState({ status: 'failed', version: release.version, message });
      throw error;
    } finally {
      activeDownload = null;
    }
  })();
  return activeDownload;
}

async function downloadAndroidPackage(options: { release: AppRelease; path: string; wifiOnly: boolean }) {
  const peerPath = await downloadSharedAndroidUpdate(options);
  if (peerPath) return peerPath;
  const official = downloadOfficialAndroidUpdate(options);
  if (official) return official;
  // Older native binaries cannot enforce Wi-Fi on DownloadManager jobs: never auto-start those jobs.
  if (options.wifiOnly) throw new Error(t("下载未完成，请重新下载。"));
  const util = await blobUtil();
  const response = await util.config({ addAndroidDownloads: {
    useDownloadManager: true, notification: true, mediaScannable: true, path: options.path,
    title: `Remote AI ${options.release.version}`, description: t("下载完成后可安装更新"), mime: APK_MIME_TYPE,
  } }).fetch('GET', options.release.androidAsset!.downloadUrl);
  return response.path() || options.path;
}

export async function installDownloadedAndroidUpdate(path: string) {
  if (Platform.OS !== 'android') throw new Error(t("应用内安装目前仅支持 Android"));
  const util = await blobUtil();
  const stored = await readStoredAndroidUpdate();
  if (!stored || stored.path !== path
    || !await verifyAndroidPackage({ path, size: stored.expectedSize, sha256: stored.sha256 })) {
    throw new Error(t("下载未完成，请重新下载。"));
  }
  await util.android.actionViewIntent(path, APK_MIME_TYPE);
}
