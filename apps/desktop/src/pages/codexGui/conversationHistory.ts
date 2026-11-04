import { guiApi } from '../../../../../shared/conversation/api';
import { reduceEvent } from '../../../../../shared/conversation/events';
import { conversationSnapshot as conversation } from './conversationSnapshot';
import { trackProcessingApproval } from '../../../../../shared/conversation/processingApprovals';
import type { GuiEvent, GuiState, Thread } from '../../../../../shared/conversation/types';

interface HistoryHost {
  getSnapshot: () => GuiState;
  patch: (state: Partial<GuiState>) => void;
  markRead: (id: string) => void;
  loaded: (id: string) => void;
}

/** Coordinate disk reads with live lifecycle events without retaining completed histories here. */
export class ConversationHistory {
  private reads = new Map<string, Promise<void>>();
  private events = new Map<string, GuiEvent[]>();
  constructor(private host: HistoryHost) {}

  receive(event: GuiEvent) {
    const id = event.params.threadId ?? event.params.thread?.id;
    if (id && ['turn/started', 'turn/completed'].includes(event.method)) this.events.get(id)?.push(event);
  }

  async select(id: string, current: () => boolean) {
    if (this.host.getSnapshot().conversations[id]?.activeTurn) { this.host.markRead(id); return; }
    const { thread } = await guiApi.request<{ thread: Thread }>({ operation: 'read', threadId: id });
    const state = this.host.getSnapshot();
    if (!current() || state.conversations[id]?.activeTurn) return;
    this.host.patch({ conversations: { ...state.conversations, [id]: conversation(thread, state.conversations[id]) } });
    this.host.markRead(id);
    const latest = this.host.getSnapshot();
    this.host.patch(latest.approvals.reduce(trackProcessingApproval, latest));
    this.host.loaded(id);
  }

  loadRemote(id: string): Promise<void> {
    const pending = this.reads.get(id);
    if (pending) return pending;
    const reading = this.readRemote(id).finally(() => { this.reads.delete(id); this.events.delete(id); });
    this.reads.set(id, reading);
    return reading;
  }

  private async readRemote(id: string) {
    const before = this.host.getSnapshot().conversations[id];
    const events: GuiEvent[] = [];
    this.events.set(id, events);
    const { thread } = await guiApi.request<{ thread: Thread }>({ operation: 'read', threadId: id });
    const state = this.host.getSnapshot();
    // Lifecycle events received during the read are newer than its history response.
    if (state.conversations[id] !== before) return;
    const loaded = { ...state, conversations: { ...state.conversations, [id]: conversation(thread, before) } };
    this.host.patch(events.reduce(reduceEvent, loaded));
  }
}
