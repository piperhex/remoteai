import type { GuiState, Thread } from '../../../../../shared/conversation/types';

export function isThreadRunning(state: GuiState, thread: Thread) {
  return Boolean(state.conversations[thread.id]?.activeTurn) || thread.status?.type === 'active'
    || state.pendingRequest?.threadId === thread.id;
}
