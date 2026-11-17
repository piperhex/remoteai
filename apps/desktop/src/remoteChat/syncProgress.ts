import type { SyncTransfer } from '../../../../shared/conversation/sync/types';
import { syncAwait } from '../../../../shared/conversation/sync/abort';

export interface NativeSyncProgress { written: number; finished: boolean; error?: string; elapsedMs: number }
const POLL_MS = 100;

export async function monitorSync(options: {
  signal: AbortSignal; offset: number; size: number; progress: SyncTransfer['progress'];
  read: () => Promise<NativeSyncProgress>;
}) {
  let previous = options.offset;
  for (;;) {
    options.signal.throwIfAborted();
    const value = await syncAwait(options.read(), options.signal);
    if (value.error) throw new Error(value.error);
    if (!Number.isSafeInteger(value.written) || value.written < previous || value.written > options.size) {
      throw new Error('CONVERSATION_SYNC_INVALID');
    }
    if (value.written !== previous) await options.progress(value.written / options.size, value.written - previous);
    previous = value.written;
    if (value.finished) {
      if (previous !== options.size) throw new Error('CONVERSATION_SYNC_INVALID');
      return;
    }
    await syncAwait(new Promise(resolve => setTimeout(resolve, POLL_MS)), options.signal);
  }
}
