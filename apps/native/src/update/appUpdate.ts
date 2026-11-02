import { t } from '../i18n';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import appConfig from '../../app.json';
import { getAndroidDownloadSnapshot } from './androidDownloadStatus';
import { downloadSharedAndroidUpdate, downloadOfficialAndroidUpdate,
  cancelNativeAndroidUpdate, nativeUpdatePath, verifyAndroidPackage } from './androidSharedDownload';
import { compareAppVersions, versionFromReleaseMetadata } from '../../../../shared/app-update/version';
import { findAndroidReleaseAsset } from '../../../../shared/app-update/androidRelease';
import { subscribeAndroidDownloadProgress, type AndroidDownloadProgress } from './androidDownloadProgress';
import { prepareUpdateNotifications } from './androidUpdateNotifications';
import { AndroidDownloadReporting } from './androidDownloadReporting';
import { AndroidUpdateAttempt, AndroidUpdateCancelled } from './androidUpdateAttempt';

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
  | { status: 'downloading'; version: string; progress?: AndroidDownloadProgress; cancelling?: boolean }
  | { status: 'cancelled'; version: string }
  | { status: 'downloaded'; version: string; path: string }
  | { status: 'failed'; version: string; message: string };

interface StoredAndroidUpdate {
  version: string;
  path: string;
  expectedSize: number;
  sha256?: string;
  cancelled?: boolean;
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
interface DownloadAttempt { control: AndroidUpdateAttempt; preparation: Promise<StoredAndroidUpdate> }

let downloadState: AndroidUpdateDownloadState = { status: 'idle' };
let activeDownload: Promise<string> | null = null;
let activeAttempt: DownloadAttempt | null = null;
let activeCancellation: Promise<void> | null = null;
let stateRefresh: Promise<AndroidUpdateDownloadState> | null = null;
const downloadListeners = new Set<DownloadListener>();

function textValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function androidAssetFrom(value: unknown): AndroidReleaseAsset | null {
  const asset = findAndroidReleaseAsset(value);
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
      throw new Error(t("client.mobile.updateCheckReturnedHttp", { value1: response.status }));
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
    throw new Error(t("client.mobile.invalidUpdateInformation"));
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
    throw new Error(t("client.mobile.backgroundDownloadsAreUnavailableInThisBuildInstallTheLatest"));
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
  if (stored.cancelled) return { status: 'cancelled', version: stored.version };
  try {
    const { status, progress } = await getAndroidDownloadSnapshot(stored.path, stored.expectedSize);
    if (status === 'pending' || status === 'running' || status === 'paused') {
      return { status: 'downloading', version: stored.version, ...(progress ? { progress } : {}) };
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
  if (Platform.OS !== 'android' || activeDownload || activeCancellation) return Promise.resolve(downloadState);
  if (stateRefresh) return stateRefresh;
  const previousState = downloadState;
  stateRefresh = restoreAndroidUpdateDownloadState().then((nextState) => {
    // A new download may have started while storage or the system query was pending.
    if (!activeDownload && !activeCancellation && downloadState === previousState) publishDownloadState(nextState);
    return downloadState;
  }).finally(() => { stateRefresh = null; });
  return stateRefresh;
}

async function prepareAndroidDownload(release: AppRelease, wifiOnly: boolean): Promise<StoredAndroidUpdate> {
  // Let recovery finish its storage cleanup before recording the new attempt.
  await stateRefresh;
  if (!wifiOnly) await prepareUpdateNotifications();
  const util = await blobUtil();
  const safeVersion = release.version.replace(/[^0-9A-Za-z.-]/g, '-');
  const path = await nativeUpdatePath(safeVersion)
    ?? `${util.fs.dirs.DownloadDir}/CodexSwitch-update-${safeVersion}-${Date.now()}.apk`;
  const stored = { version: release.version, path,
    expectedSize: release.androidAsset!.size, sha256: release.androidAsset!.sha256 };
  await SecureStore.setItemAsync(UPDATE_METADATA_KEY, JSON.stringify(stored));
  return stored;
}

export async function startAndroidUpdateDownload(release: AppRelease, options: { wifiOnly?: boolean } = {}) {
  if (Platform.OS !== 'android') throw new Error(t("client.mobile.inAppInstallationIsCurrentlyAvailableOnlyOnAndroid"));
  if (!release.androidAsset) throw new Error(t("client.mobile.noAndroidPackageAvailableForThisVersion"));
  await activeCancellation;
  if (activeDownload) return activeDownload;
  if (options.wifiOnly) await checkAutomaticDownloadAllowed(release.version);
  // Another caller may have started while the automatic check read storage.
  if (activeDownload) return activeDownload;
  const androidAsset = release.androidAsset;
  const attempt = { control: new AndroidUpdateAttempt(),
    preparation: prepareAndroidDownload(release, options.wifiOnly === true) };
  activeAttempt = attempt;
  publishDownloadState({ status: 'downloading', version: release.version, progress: {
    receivedBytes: 0, totalBytes: androidAsset.size, bytesPerSecond: 0, phase: 'downloading',
  } });
  activeDownload = runAndroidDownload({ release, attempt, wifiOnly: options.wifiOnly === true });
  return activeDownload;
}

async function checkAutomaticDownloadAllowed(version: string) {
  const stored = await readStoredAndroidUpdate();
  const cancelled = stored?.cancelled && stored.version === version;
  const locallyCancelled = downloadState.status === 'cancelled' && downloadState.version === version;
  if (cancelled || locallyCancelled || activeCancellation) throw new AndroidUpdateCancelled();
}

async function runAndroidDownload({ release, attempt, wifiOnly }: {
  release: AppRelease; attempt: DownloadAttempt; wifiOnly: boolean;
}) {
  let unsubscribe: (() => void) | undefined;
  const reporting = new AndroidDownloadReporting(release.androidAsset!.size);
  try {
    const stored = await attempt.preparation;
    await attempt.control.checkActive();
    unsubscribe = subscribeAndroidDownloadProgress(stored.path, progress => {
      if (!attempt.control.acceptsProgress) return;
      publishDownloadState({ status: 'downloading', version: release.version, progress });
    });
    const path = await downloadAndroidPackage({ release, path: stored.path, wifiOnly, reporting,
      checkActive: () => attempt.control.checkActive() });
    await finishAndroidDownload({ stored: { ...stored, path }, control: attempt.control, reporting });
    return path;
  } catch (error) {
    await attempt.control.checkActive();
    if (error instanceof AndroidUpdateCancelled) throw error;
    reporting.finish(false);
    const message = t("client.settings.theDownloadDidNotFinishPleaseDownloadItAgain");
    await SecureStore.deleteItemAsync(UPDATE_METADATA_KEY).catch(() => undefined);
    publishDownloadState({ status: 'failed', version: release.version, message });
    throw error;
  } finally {
    unsubscribe?.();
    activeDownload = null;
    activeAttempt = null;
  }
}

async function finishAndroidDownload({ stored, control, reporting }: {
  stored: StoredAndroidUpdate; control: AndroidUpdateAttempt; reporting: AndroidDownloadReporting;
}) {
  await control.checkActive();
  publishDownloadState({ status: 'downloading', version: stored.version, progress: {
    receivedBytes: stored.expectedSize, totalBytes: stored.expectedSize, bytesPerSecond: 0, phase: 'verifying',
  } });
  reporting.verify();
  if (!await verifyAndroidPackage({ path: stored.path, size: stored.expectedSize, sha256: stored.sha256 })) {
    throw new Error(t("client.settings.theDownloadDidNotFinishPleaseDownloadItAgain"));
  }
  await control.checkActive();
  await SecureStore.setItemAsync(UPDATE_METADATA_KEY, JSON.stringify(stored));
  await control.checkActive();
  reporting.finish(true);
  publishDownloadState({ status: 'downloaded', version: stored.version, path: stored.path });
}

async function downloadAndroidPackage(options: {
  release: AppRelease; path: string; wifiOnly: boolean; reporting: AndroidDownloadReporting;
  checkActive(): Promise<void>;
}) {
  const peerPath = await downloadSharedAndroidUpdate(options);
  await options.checkActive();
  if (peerPath) return peerPath;
  options.reporting.useOrigin();
  const official = downloadOfficialAndroidUpdate(options);
  if (official) return official;
  // Older native binaries cannot enforce Wi-Fi on DownloadManager jobs: never auto-start those jobs.
  if (options.wifiOnly) throw new Error(t("client.settings.theDownloadDidNotFinishPleaseDownloadItAgain"));
  const util = await blobUtil();
  await options.checkActive();
  const response = await util.config({ addAndroidDownloads: {
    useDownloadManager: true, notification: true, mediaScannable: true, path: options.path,
    title: `Remote AI ${options.release.version}`, description: t("client.mobile.installTheUpdateWhenTheDownloadFinishes"), mime: APK_MIME_TYPE,
  } }).fetch('GET', options.release.androidAsset!.downloadUrl);
  return response.path() || options.path;
}

export function cancelAndroidUpdateDownload(): Promise<void> {
  if (activeCancellation) return activeCancellation;
  if (Platform.OS !== 'android' || downloadState.status !== 'downloading') return Promise.resolve();
  const previous = downloadState;
  const attempt = activeAttempt;
  const download = activeDownload;
  publishDownloadState({ ...previous, cancelling: true });
  const storedUpdate = (async () => {
    await stateRefresh;
    const stored = attempt ? await attempt.preparation : await readStoredAndroidUpdate();
    if (!stored) throw new Error('Update download unavailable');
    return stored;
  })();
  const stop = async () => cancelNativeAndroidUpdate((await storedUpdate).path);
  const stopping = attempt ? attempt.control.cancel(stop) : stop();
  activeCancellation = (async () => {
    await stopping;
    // The old attempt must finish before saving cancellation or allowing a new download.
    await download?.catch(() => undefined);
    const stored = await storedUpdate;
    await SecureStore.setItemAsync(UPDATE_METADATA_KEY, JSON.stringify({ ...stored, cancelled: true }));
    publishDownloadState({ status: 'cancelled', version: stored.version });
  })().catch(error => {
    if (downloadState.status === 'downloading') publishDownloadState({ ...downloadState, cancelling: false });
    throw error;
  }).finally(() => { activeCancellation = null; });
  return activeCancellation;
}

export async function installDownloadedAndroidUpdate(path: string) {
  if (Platform.OS !== 'android') throw new Error(t("client.mobile.inAppInstallationIsCurrentlyAvailableOnlyOnAndroid"));
  const util = await blobUtil();
  const stored = await readStoredAndroidUpdate();
  if (!stored || stored.cancelled || stored.path !== path
    || !await verifyAndroidPackage({ path, size: stored.expectedSize, sha256: stored.sha256 })) {
    throw new Error(t("client.settings.theDownloadDidNotFinishPleaseDownloadItAgain"));
  }
  await util.android.actionViewIntent(path, APK_MIME_TYPE);
}
