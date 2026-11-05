import { conversation } from '../../../../../shared/conversation/events';
import { mergeHistory } from '../../../../../shared/remote-chat/client/history';
import type { Conversation, Thread } from '../../../../../shared/conversation/types';

/** A disk snapshot may precede a confirmed send; explicit edits still use conversation() directly. */
export function conversationSnapshot(thread: Thread, previous?: Conversation): Conversation {
  if (!previous) return conversation(thread);
  const live = { ...previous.thread, turns: previous.turns };
  return { ...conversation(mergeHistory(thread, live, live), previous), historyPage: previous.historyPage };
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
