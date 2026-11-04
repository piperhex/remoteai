import { conversation } from '../../../../../shared/conversation/events';
import { mergeHistory } from '../../../../../shared/remote-chat/client/history';
import type { Conversation, Thread } from '../../../../../shared/conversation/types';

/** A disk snapshot may precede a confirmed send; explicit edits still use conversation() directly. */
export function conversationSnapshot(thread: Thread, previous?: Conversation): Conversation {
  if (!previous) return conversation(thread);
  const live = { ...previous.thread, turns: previous.turns };
  return conversation(mergeHistory(thread, live, live), previous);
}
