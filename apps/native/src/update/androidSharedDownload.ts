import { NativeModules } from 'react-native';
import type { AppRelease } from './appUpdate';
import { findUpdatePeers } from '../../../../shared/app-update/peerLookup';

interface UpdateModule {
  canAutoDownload(): Promise<boolean>;
  updatePath(version: string): Promise<string>;
  artifactId(metadata: string): Promise<string>;
  downloadPeers(options: string): Promise<string>;
  downloadOfficial(options: string): Promise<string>;
  verifyPackage(options: string): Promise<boolean>;
}
const module = () => NativeModules.AppUpdate as UpdateModule | undefined;
export const canAutoDownload = () => module()?.canAutoDownload?.() ?? Promise.resolve(false);
export const nativeUpdatePath = (version: string) => module()?.updatePath?.(version);

export async function verifyAndroidPackage(options: { path: string; size: number; sha256?: string }) {
  const native = module();
  // Old installed binaries retain the existing system-installer signature check.
  return native?.verifyPackage ? native.verifyPackage(JSON.stringify(options)) : true;
}

export async function downloadSharedAndroidUpdate(options: {
  release: AppRelease; path: string; wifiOnly: boolean;
}): Promise<string | null> {
  const native = module();
  const asset = options.release.androidAsset;
  if (!native?.downloadPeers || !asset?.sha256) return null;
  const metadata = { version: options.release.version, url: asset.downloadUrl, size: asset.size, sha256: asset.sha256 };
  let lease: Awaited<ReturnType<typeof findUpdatePeers>> | undefined;
  try {
    const { loadSession } = await import('../api/client');
    const session = await loadSession();
    if (!session) return null;
    const artifact = await native.artifactId(JSON.stringify(metadata));
    lease = await findUpdatePeers(session, artifact);
    return await native.downloadPeers(JSON.stringify({ ...metadata, path: options.path,
      wifiOnly: options.wifiOnly, artifact, configs: lease.configs }));
  } catch {
    // Peer lookup, transport, file and integrity failures all return to the original GitHub URL.
    return null;
  } finally { lease?.close(); }
}

export function downloadOfficialAndroidUpdate(options: {
  release: AppRelease; path: string; wifiOnly: boolean;
}) {
  const native = module();
  if (!native?.downloadOfficial) return null;
  return native.downloadOfficial(JSON.stringify({ path: options.path, wifiOnly: options.wifiOnly,
    url: options.release.androidAsset?.downloadUrl, version: options.release.version }));
}
