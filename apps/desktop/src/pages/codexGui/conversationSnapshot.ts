import { conversation } from '../../../../../shared/conversation/events';
import { mergeHistory } from '../../../../../shared/remote-chat/client/history';
import type { Conversation, Thread } from '../../../../../shared/conversation/types';

/** A disk snapshot may precede a confirmed send; explicit edits still use conversation() directly. */
export function conversationSnapshot(thread: Thread, previous?: Conversation): Conversation {
  if (!previous) return conversation(thread);
  const live = { ...previous.thread, turns: previous.turns };
  const summarized = new Set(thread.turns?.filter(turn => turn.items.some(item => item.processRef))
    .map(turn => turn.id));
  // The merged snapshot owns these ranges. Reusing old items would refill a folded process on resume.
  const details = summarized.size ? { ...previous, turns: previous.turns.map(turn => summarized.has(turn.id)
    ? { ...turn, items: [] } : turn) } : previous;
  return { ...conversation(mergeHistory(thread, live, live), details), historyPage: previous.historyPage };
}

/** Paged reads contain the entire requested range in authoritative chronological order. */
export function pagedConversationSnapshot(thread: Thread, previous: Conversation | undefined,
  before: Conversation | undefined): Conversation {
  if (!previous) return conversation(thread);
  const live = { ...previous.thread, turns: previous.turns };
  // mergeHistory already reconciles live items. Reusing their old order in conversation()
  // would append a newly fetched prefix after the visible tail.
  const details = { ...previous, turns: previous.turns.map(turn => ({ ...turn, items: [] })) };
  return { ...conversation(mergeHistory(thread, live, before
    ? { ...before.thread, turns: before.turns } : { ...thread, turns: [] }), details),
    historyPage: previous.historyPage };
}

/** Resume returns lifecycle only; omitted persisted turns and items are not deletions. */
export function resumedConversationSnapshot(thread: Thread, previous?: Conversation): Conversation {
  if (!previous) return conversation(thread);
  const live = { ...previous.thread, turns: previous.turns };
  const merged = mergeHistory(thread, live, live, { retainCached: true });
  const byId = new Map(merged.turns?.map(turn => [turn.id, turn]));
  // mergeHistory starts with the incoming tail. Restore the cached chronological prefix.
  const order = new Set([...previous.turns.map(turn => turn.id), ...(thread.turns ?? []).map(turn => turn.id)]);
  const turns = [...order].flatMap(id => { const turn = byId.get(id); return turn ? [turn] : []; });
  return { ...conversation({ ...merged, turns }, previous), historyPage: previous.historyPage };
}
