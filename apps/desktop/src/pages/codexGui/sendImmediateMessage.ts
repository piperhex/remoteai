import { guiApi } from '../../../../../shared/conversation/api';
import { withSentMessage } from '../../../../../shared/conversation/sentMessages';
import type { GuiState, MessageInput } from '../../../../../shared/conversation/types';

interface Host {
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
  report: (error: unknown) => void;
  flushQueue: () => void;
}

/** Append to the active turn without adding a message to the persisted queue. */
export async function sendImmediateMessage(host: Host, threadId: string, input: MessageInput): Promise<boolean> {
  const state = host.getSnapshot();
  const current = state.conversations[threadId];
  const turnId = current?.activeTurn;
  if (!turnId) return false;
  const userMessageIndex = current.turns.find(turn => turn.id === turnId)
    ?.items.filter(item => item.type === 'userMessage').length ?? 0;
  const message = { ...input, ...state.settings, id: crypto.randomUUID() };
  host.patch({ sending: true, error: '' });
  try {
    await guiApi.request({ operation: 'steer', threadId, turnId, ...input });
    const latest = host.getSnapshot().conversations[threadId];
    if (latest) host.patch({ conversations: { ...host.getSnapshot().conversations, [threadId]: { ...latest,
      turns: latest.turns.map(turn => turn.id === turnId
        ? withSentMessage(turn, [message], userMessageIndex) : turn) } } });
    return true;
  } catch (error) { host.report(error); return false; }
  finally { host.patch({ sending: false }); host.flushQueue(); }
}
