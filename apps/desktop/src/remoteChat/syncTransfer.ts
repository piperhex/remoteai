import { invoke } from '@tauri-apps/api/core';
import type { SyncTransfer, SyncRequest } from '../../../../shared/conversation/sync/types';
import { monitorSync, type NativeSyncProgress } from './syncProgress';
import { transferNativeBridge } from './syncBridge';

/** Native file bytes never cross the WebView. RPC carries only authorization, progress and cancellation. */
export async function transferNativeSync(options: SyncTransfer): Promise<boolean> {
  const { source, destination, sourceBundle, destinationBundle, signal, offset, progress } = options;
  if (sourceBundle.binaryVersion !== 1 || destinationBundle.binaryVersion !== 1) return false;
  if (!source.nativeLocal && !destination.nativeLocal) return transferNativeBridge(options);
  if (source.nativeLocal && destination.nativeLocal) return false;
  const remote = source.nativeLocal ? destination : source;
  const connection = remote.nativeLink?.();
  if (!connection || remote.mode?.() !== 'direct') return false;
  const cipher = await connection.cipher;
  signal.throwIfAborted();
  const transferId = crypto.randomUUID(), epoch = crypto.randomUUID();
  const identity = { transferId, epoch, size: sourceBundle.size, sha256: sourceBundle.sha256, offset };
  const localDirection = source.nativeLocal ? 'send' : 'receive';
  const localBundle = source.nativeLocal ? sourceBundle : destinationBundle;
  const remoteBundle = source.nativeLocal ? destinationBundle : sourceBundle;
  let localJob: string | undefined, remoteJob: string | undefined;
  const startLocal = async () => { localJob = await invoke<string>('codex_conversation_sync_native_start', {
    request: { ...identity, bundle: localBundle.id, direction: localDirection, cipher, target: connection.target },
  }); };
  const startRemote = async () => { remoteJob = await remote.request<string>({ action: 'nativeStart',
    ...identity, id: remoteBundle.id, direction: localDirection === 'send' ? 'receive' : 'send' }); };
  try {
    // A receiver must bind its bounded inbox before its sender emits the first record.
    if (localDirection === 'receive') { await startLocal(); signal.throwIfAborted(); await startRemote(); }
    else { await startRemote(); signal.throwIfAborted(); await startLocal(); }
    await monitorSync({ signal, offset, size: sourceBundle.size, progress,
      read: () => invoke<NativeSyncProgress>('codex_conversation_sync_native_poll', { id: localJob }) });
    await monitorSync({ signal, offset, size: sourceBundle.size, progress: () => {},
      read: () => remote.request<NativeSyncProgress>({ action: 'nativePoll', id: remoteJob! }) });
    return true;
  } finally {
    await Promise.allSettled([
      localJob ? invoke('codex_conversation_sync_native_close', { id: localJob }) : Promise.resolve(),
      remoteJob ? remote.request<void>({ action: 'nativeClose', id: remoteJob }) : Promise.resolve(),
    ]);
  }
}

export function isNativeSyncRequest(request: SyncRequest) {
  return request.action === 'nativeStart' || request.action === 'nativePoll' || request.action === 'nativeClose';
}
