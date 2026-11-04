import type { Conversation, GuiState } from '../../../../../shared/conversation/types';

export const CONVERSATION_CACHE_BYTES = 64 * 1024 * 1024;
const STRING_BYTES = 2;
const VALUE_BYTES = 8;
const OBJECT_BYTES = 32;

/** Conservative retained-size estimate, cached by immutable object identity; never serializes output. */
class RetainedBytes {
  private sizes = new WeakMap<object, number>();

  size(value: unknown): number {
    if (typeof value === 'string') return value.length * STRING_BYTES;
    if (!value || typeof value !== 'object') return VALUE_BYTES;
    const cached = this.sizes.get(value);
    if (cached !== undefined) return cached;
    this.sizes.set(value, 0);
    const bytes = Object.entries(value).reduce((total, [key, child]) =>
      total + key.length * STRING_BYTES + VALUE_BYTES + this.size(child), OBJECT_BYTES);
    this.sizes.set(value, bytes);
    return bytes;
  }
}

/** Only disposable history consumes the budget. Active work and callers holding a lease stay resident. */
export class ConversationCache {
  private sizes = new RetainedBytes();
  private recent = new Map<string, number>();
  private leases = new Map<string, number>();
  private serial = 0;
  private disposable = new WeakMap<Conversation, boolean>();

  constructor(private readonly budget = CONVERSATION_CACHE_BYTES) {}

  touch(id: string) { this.recent.set(id, ++this.serial); }

  retain(id: string) {
    this.touch(id);
    this.leases.set(id, (this.leases.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.leases.get(id) ?? 1) - 1;
      if (count) this.leases.set(id, count);
      else this.leases.delete(id);
    };
  }

  trim(state: GuiState, retained: Iterable<string> = []): GuiState['conversations'] {
    const protectedIds = this.protectedIds(state);
    for (const id of retained) protectedIds.add(id);
    const candidates: { id: string; bytes: number }[] = [];
    for (const id of this.recent.keys()) if (!state.conversations[id]) this.recent.delete(id);
    for (const [id, value] of Object.entries(state.conversations)) {
      if (!this.recent.has(id)) this.touch(id);
      if (!protectedIds.has(id) && this.completed(value)) candidates.push({ id, bytes: this.sizes.size(value) });
    }
    let bytes = candidates.reduce((total, entry) => total + entry.bytes, 0);
    if (bytes <= this.budget) return state.conversations;
    const conversations = { ...state.conversations };
    candidates.sort((a, b) => this.recent.get(a.id)! - this.recent.get(b.id)!);
    for (const entry of candidates) {
      if (bytes <= this.budget) break;
      delete conversations[entry.id];
      this.recent.delete(entry.id);
      bytes -= entry.bytes;
    }
    return conversations;
  }

  private completed(value: Conversation) {
    const cached = this.disposable.get(value);
    if (cached !== undefined) return cached;
    const completed = !value.activeTurn && !value.processing
      && value.turns.every(turn => turn.status !== 'inProgress'
        && !turn.items.some(item => item.localEcho));
    this.disposable.set(value, completed);
    return completed;
  }

  private protectedIds(state: GuiState) {
    return new Set([
      state.selected, state.pendingRequest?.threadId, state.compacting, state.deleting, state.forking,
      state.capacityRetry?.threadId, ...this.leases.keys(),
      ...state.approvals.map(event => event.params.threadId),
      ...Object.keys(state.queued).filter(id => state.queued[id].length),
      ...Object.keys(state.goals ?? {}).filter(id => state.goals?.[id]?.status === 'active'),
    ]);
  }
}
