import { commandOutcome, countCommandOutcomes, type CommandMetricTurn }
  from '../../../../shared/remote-chat/commandMetrics';
import type { GuiEvent, Thread } from '../../../../shared/conversation/types';

const MAX_METRIC_THREADS = 16;
const RESET_EVENTS = new Set(['thread/started', 'thread/resumed', 'thread/archived', 'thread/unarchived',
  'thread/deleted', 'thread/compacted', 'thread/historyChanged']);

/** Retain only command outcomes from full host history, before remote pagination. */
export class CommandMetricsStore {
  private readonly threads = new Map<string, Map<string, boolean>>();

  seed(thread: Thread) {
    if (!thread.turns) return;
    const outcomes = new Map<string, boolean>();
    this.update(outcomes, thread.turns);
    this.threads.delete(thread.id);
    this.threads.set(thread.id, outcomes);
    if (this.threads.size > MAX_METRIC_THREADS) this.threads.delete(this.threads.keys().next().value!);
  }

  read(threadId: string) {
    const outcomes = this.threads.get(threadId);
    return outcomes ? countCommandOutcomes(outcomes.values()) : {};
  }

  clear() { this.threads.clear(); }

  receive(event: GuiEvent) {
    if (['connection/closed', 'codex/disconnected'].includes(event.method)) { this.clear(); return; }
    const threadId = event.params.threadId ?? event.params.thread?.id;
    if (!threadId || event.id != null) return;
    if (RESET_EVENTS.has(event.method)) { this.threads.delete(threadId); return; }
    const outcomes = this.threads.get(threadId);
    if (!outcomes) return;
    const { turn, turnId, item } = event.params;
    if (turn?.items) this.update(outcomes, [turn]);
    if (turnId && item) this.update(outcomes, [{ id: turnId, items: [item] }]);
  }

  private update(outcomes: Map<string, boolean>, turns: readonly CommandMetricTurn[]) {
    for (const turn of turns) {
      for (const item of turn.items) {
        const key = JSON.stringify([turn.id, item.id]);
        const outcome = commandOutcome(item);
        if (outcome !== undefined) outcomes.set(key, outcome);
      }
    }
  }
}
