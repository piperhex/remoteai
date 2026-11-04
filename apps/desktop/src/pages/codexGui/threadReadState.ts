import { savePreferences } from "./preferences";
import type { GuiEvent, GuiState, Thread } from "../../../../../shared/conversation/types";

interface ReadStateHost {
  getSnapshot: () => GuiState;
  patch: (patch: Partial<GuiState>) => void;
}

export class GuiReadState {
  private viewing = false;
  constructor(private host: ReadStateHost) {}

  setViewing = (viewing: boolean) => {
    this.viewing = viewing;
    const state = this.host.getSnapshot();
    if (viewing && state.selected && state.conversations[state.selected]) this.markRead(state.selected);
  };

  markRead = (id: string) => {
    const state = this.host.getSnapshot();
    const current = state.threadReadState[id];
    if (!this.viewing || state.selected !== id || !current?.unread) return;
    this.host.patch({ threadReadState: { ...state.threadReadState, [id]: { ...current, unread: false } } });
    savePreferences(this.host.getSnapshot());
  };

  markRemoteRead = (id: string, turnId: string) => {
    const state = this.host.getSnapshot();
    const current = state.threadReadState[id];
    // A delayed phone acknowledgement must not clear a newer unread reply.
    if (!current?.unread || current.turnId !== turnId) return;
    this.host.patch({ threadReadState: { ...state.threadReadState, [id]: { ...current, unread: false } } });
    savePreferences(this.host.getSnapshot());
  };

  observeThreads = (threads: Thread[]) => {
    const state = this.host.getSnapshot();
    const previous = new Map(state.threads.map((thread) => [thread.id, thread]));
    const finished = threads.filter((thread) => previous.get(thread.id)?.status?.type === "active"
      && thread.status?.type !== "active" && !state.conversations[thread.id]?.activeTurn);
    if (!finished.length) return;
    const threadReadState = { ...state.threadReadState };
    // A list refresh can be the first sign of completion after the connection was suspended.
    finished.forEach((thread) => {
      threadReadState[thread.id] = { turnId: `refresh:${thread.updatedAt}`, unread: true };
    });
    this.host.patch({ threadReadState });
    savePreferences(this.host.getSnapshot());
  };

  receive = (event: GuiEvent) => {
    const { threadId, turn } = event.params;
    if (!threadId || !turn || !["turn/started", "turn/completed"].includes(event.method)) return;
    const state = this.host.getSnapshot();
    if (event.method === "turn/completed" && state.threadReadState[threadId]?.turnId === turn.id) return;
    const running = event.method === "turn/started" || Boolean(state.conversations[threadId]?.activeTurn);
    this.host.patch({ threads: state.threads.map((thread) => thread.id === threadId
      ? { ...thread, status: { type: running ? "active" : "idle" } } : thread) });
    if (event.method !== "turn/completed") return;
    const unread = !(this.viewing && state.selected === threadId && state.conversations[threadId]);
    this.host.patch({ threadReadState: { ...state.threadReadState, [threadId]: { turnId: turn.id, unread } } });
    savePreferences(this.host.getSnapshot());
  };
}
