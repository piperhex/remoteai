import { bytesToHex } from '@noble/hashes/utils';
import { getRandomBytes } from 'expo-crypto';
import { bulkCapability, type BulkClient } from '../../../../shared/remote-chat/bulkControl';
import { authenticateManifest } from '../../../../shared/remote-chat/downloadManifest';
import { bulkAssert } from '../../../../shared/remote-chat/bulkLimits';
import { negotiateBulk } from '../../../../shared/remote-chat/bulkProtocol';
import type { DownloadNative } from './types';

function epochId() {
  const bytes = getRandomBytes(16); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function openNativeBulk(options: {
  taskId: string; id: string; client: BulkClient; native: DownloadNative; signal: AbortSignal;
}) {
  const { taskId, id, client, native } = options;
  const epoch = epochId();
  const path = client.path(); bulkAssert(path && native.manifestPage, 'PATH_UNAVAILABLE');
  const capability = bulkCapability('synced-file', client.transport()?.recordBytes);
  const opened = await client.open({ transferId: taskId, id, epoch, path, capability }, options.signal);
  try {
    bulkAssert(opened.transferId === taskId && opened.epoch === epoch && opened.path === path, 'INVALID_MANIFEST');
    negotiateBulk(capability, opened.capability);
    await authenticateManifest({ manifest: opened.manifest, signal: options.signal,
      read: page => client.page(taskId, page), store: page => native.manifestPage!(taskId, JSON.stringify(page)) });
    const cipher = client.cipher({ transferId: taskId, manifestId: opened.manifest.manifestId, epoch });
    const material = cipher.receiverMaterial(); cipher.destroy();
    const key = bytesToHex(material.key); material.key.fill(0);
    return { ...opened, key };
  } catch (error) {
    await client.cancel(taskId, epoch).catch(() => console.warn('Cancelled transfer will expire.')); throw error;
  }
}
