import { invoke } from '@tauri-apps/api/core';
import type { SyncTransfer } from '../../../../shared/conversation/sync/types';
import { monitorSync, type NativeSyncProgress } from './syncProgress';

/** Forward between two remote hosts in Rust; the coordinating desktop never sees archive payloads. */
export async function transferNativeBridge(options: SyncTransfer): Promise<boolean> {
  const { source, destination, sourceBundle, destinationBundle, signal, offset, progress } = options;
  const left = source.nativeLink?.(), right = destination.nativeLink?.();
  if (!left || !right || source.mode?.() !== 'direct' || destination.mode?.() !== 'direct') return false;
  const first = { target: left.target, cipher: await left.cipher, transferId: crypto.randomUUID(), epoch: crypto.randomUUID() };
  const second = { target: right.target, cipher: await right.cipher, transferId: crypto.randomUUID(), epoch: crypto.randomUUID() };
  const identity = { size: sourceBundle.size, sha256: sourceBundle.sha256, offset };
  let sourceJob: string | undefined, destinationJob: string | undefined, localJob: string | undefined;
  try {
    signal.throwIfAborted();
    destinationJob = await destination.request<string>({ action: 'nativeStart', direction: 'receive',
      id: destinationBundle.id, ...identity, transferId: second.transferId, epoch: second.epoch });
    signal.throwIfAborted();
    localJob = await invoke<string>('codex_conversation_sync_native_bridge', {
      request: { ...identity, source: first, destination: second },
    });
    signal.throwIfAborted();
    sourceJob = await source.request<string>({ action: 'nativeStart', direction: 'send', id: sourceBundle.id,
      ...identity, transferId: first.transferId, epoch: first.epoch });
    await monitorSync({ signal, offset, size: identity.size, progress,
      read: () => invoke<NativeSyncProgress>('codex_conversation_sync_native_poll', { id: localJob }) });
    for (const [host, id] of [[source, sourceJob], [destination, destinationJob]] as const) {
      await monitorSync({ signal, offset, size: identity.size, progress: () => {},
        read: () => host.request<NativeSyncProgress>({ action: 'nativePoll', id }) });
    }
    return true;
  } finally {
    await Promise.allSettled([
      localJob ? invoke('codex_conversation_sync_native_close', { id: localJob }) : Promise.resolve(),
      sourceJob ? source.request({ action: 'nativeClose', id: sourceJob }) : Promise.resolve(),
      destinationJob ? destination.request({ action: 'nativeClose', id: destinationJob }) : Promise.resolve(),
    ]);
  }
}
