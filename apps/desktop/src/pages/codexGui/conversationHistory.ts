import { guiApi } from '../../../../../shared/conversation/api';
import { reduceEvent } from '../../../../../shared/conversation/events';
import { pagedConversationSnapshot as conversation } from './conversationSnapshot';
import { trackProcessingApproval } from '../../../../../shared/conversation/processingApprovals';
import type { GuiEvent, GuiState, Thread, Turn } from '../../../../../shared/conversation/types';
import type { HistoryPage } from '../../../../../shared/remote-chat/historyPage';

interface HistoryResponse { thread: Thread; page?: HistoryPage }

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
  private older = new Map<string, Promise<Turn[] | undefined>>();
  constructor(private host: HistoryHost) {}

  receive(event: GuiEvent) {
    const id = event.params.threadId ?? event.params.thread?.id;
    if (id && ['turn/started', 'turn/completed'].includes(event.method)) this.events.get(id)?.push(event);
  }

  async select(id: string, current: () => boolean) {
    const before = this.host.getSnapshot().conversations[id];
    const start = before?.historyPage?.start;
    const { thread, page } = await guiApi.request<HistoryResponse>({ operation: 'read', threadId: id,
      window: { start } });
    const state = this.host.getSnapshot();
    if (!current()) return;
    this.host.patch({ conversations: { ...state.conversations,
      [id]: { ...conversation(thread, state.conversations[id], before), historyPage: page } } });
    this.host.markRead(id);
    const latest = this.host.getSnapshot();
    this.host.patch(latest.approvals.reduce(trackProcessingApproval, latest));
    this.host.loaded(id);
  }

  loadOlder(id: string, current: () => boolean): Promise<Turn[] | undefined> {
    const pending = this.older.get(id);
    if (pending) return pending;
    const reading = this.readOlder(id, current).finally(() => this.older.delete(id));
    this.older.set(id, reading);
    return reading;
  }

  private async readOlder(id: string, current: () => boolean) {
    const previous = this.host.getSnapshot().conversations[id];
    if (!previous?.historyPage?.hasMore) return;
    const { thread, page } = await guiApi.request<HistoryResponse>({ operation: 'read', threadId: id,
      window: { start: previous.historyPage.start, older: true } });
    if (!current()) return;
    const state = this.host.getSnapshot();
    const loaded = { ...conversation(thread, state.conversations[id], previous), historyPage: page };
    this.host.patch({ conversations: { ...state.conversations, [id]: loaded } });
    this.host.loaded(id);
    return loaded.turns;
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
    const { thread, page } = await guiApi.request<HistoryResponse>({ operation: 'read', threadId: id,
      window: { start: before?.historyPage?.start } });
    const state = this.host.getSnapshot();
    // Lifecycle events received during the read are newer than its history response.
    if (state.conversations[id] !== before) return;
    const loaded = { ...state, conversations: { ...state.conversations,
      [id]: { ...conversation(thread, before, before), historyPage: page } } };
    this.host.patch(events.reduce(reduceEvent, loaded));
  }
}
