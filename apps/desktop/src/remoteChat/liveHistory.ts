import type { GuiEvent, Thread } from '../../../../shared/conversation/types';
import { updateThread } from '../../../../shared/remote-chat/client/events';
import { discardStaleRunningTurns, mergeHistory } from '../../../../shared/remote-chat/client/history';

const MAX_LIVE_THREADS = 16;

/** app-server history can lag behind its notifications until a turn is written to disk. */
export class LiveHistory {
  private readonly threads = new Map<string, Thread>();

  receive(event: GuiEvent) {
    if (['connection/closed', 'codex/disconnected'].includes(event.method)) {
      this.threads.clear();
      return;
    }
    const id = event.params.threadId ?? event.params.thread?.id;
    if (!id || event.id != null) return;
    if (['thread/started', 'thread/resumed', 'thread/archived', 'thread/unarchived', 'thread/deleted',
      'thread/compacted', 'thread/historyChanged'].includes(event.method)) {
      const tokenUsage = this.threads.get(id)?.tokenUsage;
      this.threads.delete(id);
      if (tokenUsage && event.method !== 'thread/deleted') {
        this.threads.set(id, { id, preview: '', cwd: '', updatedAt: 0, turns: [], tokenUsage });
      }
      return;
    }
    if (!event.params.turnId && !event.params.turn?.id && !event.params.tokenUsage) return;
    const previous = this.threads.get(id);
    const thread = previous && event.method !== 'turn/started'
      ? previous : { id, preview: '', cwd: '', updatedAt: 0, turns: [], tokenUsage: previous?.tokenUsage };
    this.threads.delete(id);
    this.threads.set(id, updateThread(thread, event));
    if (this.threads.size > MAX_LIVE_THREADS) this.threads.delete(this.threads.keys().next().value!);
  }

  async read(threadId: string, read: () => Promise<{ thread: Thread }>): Promise<Thread> {
    const before = this.threads.get(threadId);
    const { thread: snapshot } = await read();
    const live = this.threads.get(snapshot.id);
    if (!live) return snapshot;
    const empty = { ...snapshot, turns: [], tokenUsage: undefined };
    const current = discardStaleRunningTurns(snapshot, live, before ?? empty);
    this.threads.set(snapshot.id, current);
    return mergeHistory(snapshot, current, empty);
  }
}
