import { completeTurnTiming, restoreTurnTiming } from '../../../../../shared/conversation/turnTiming';
import { mergeMessageItems } from '../../../../../shared/conversation/sentMessages';
import { restoreProcessing } from '../../../../../shared/conversation/processing';
import type { CapacityRetry } from '../../../../../shared/conversation/capacityRetry';
import type { GuiReadState } from './threadReadState';
import type { GuiState, Turn } from '../../../../../shared/conversation/types';

interface Host {
  getSnapshot: () => GuiState;
  patch: (state: Partial<GuiState>) => void;
  readState: GuiReadState;
  capacityRetry: CapacityRetry;
}

/** Merge send receipts without overwriting lifecycle events that arrived before the response. */
export function acceptGuiTurn(host: Host, threadId: string, turn: Turn) {
  const state = host.getSnapshot();
  const current = state.conversations[threadId];
  if (!current) return;
  if (current.turns.some(entry => entry.id === turn.id)) {
    host.patch({ conversations: { ...state.conversations, [threadId]: { ...current,
      turns: current.turns.map(entry => entry.id === turn.id
        ? { ...entry, items: mergeMessageItems(turn.items ?? [], entry.items) } : entry) } } });
    host.capacityRetry.receive({ method: 'turn/completed', params: { threadId, turn } });
    return;
  }
  const timedTurn = turn.status === 'inProgress' ? restoreTurnTiming(turn) : completeTurnTiming(turn);
  host.patch({ conversations: { ...state.conversations, [threadId]: { ...current,
    turns: [...current.turns, timedTurn], activeTurn: turn.status === 'inProgress' ? turn.id : null,
    processing: turn.status === 'inProgress' ? restoreProcessing(timedTurn) : undefined } } });
  host.readState.receive({ method: turn.status === 'inProgress' ? 'turn/started' : 'turn/completed',
    params: { threadId, turn } });
  if (turn.status !== 'inProgress') host.capacityRetry.receive({ method: 'turn/completed', params: { threadId, turn } });
}
