import { guiText } from "../../i18n/guiText";
import type { GuiController } from './controller';
import type { GuiEvent, GuiState, Thread } from './types';
import { initialState, savePreferences } from './preferences';
import { readProjects, folderName } from './projectCatalog';
import { emptySidebar, type SidebarSnapshot } from '../../../../../shared/remote-chat/sidebar';

type Binding = Pick<GuiController, 'getSnapshot' | 'subscribe' | 'readState'>;

/** Shares the desktop's project labels and read receipts without loading conversation bodies. */
export class SidebarBridge {
  private binding?: Binding;
  private known = new Map<string, Thread>();
  private value = emptySidebar();
  private clock = 0;
  private readonly changed = new Map<string, number>();
  version = () => this.clock;
  snapshot = () => this.value;
  private readonly listeners = new Set<(snapshot: SidebarSnapshot) => void>();

  subscribe = (listener: (snapshot: SidebarSnapshot) => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  attach(binding: Binding) {
    this.binding = binding;
    let previous: GuiState | undefined;
    const update = () => {
      const state = binding.getSnapshot();
      if (previous?.threads === state.threads && previous.threadReadState === state.threadReadState
        && previous.projectOverrides === state.projectOverrides && previous.projects === state.projects
        && previous.pendingRequest === state.pendingRequest && previous.pins === state.pins) return;
      previous = state;
      state.threads.forEach((thread) => this.known.set(thread.id, thread));
      this.publish(state);
    };
    update();
    const unsubscribe = binding.subscribe(update);
    return () => { unsubscribe(); if (this.binding === binding) this.binding = undefined; };
  }

  private publish(state = this.binding?.getSnapshot() ?? initialState()) {
    const names = new Map(readProjects().map((project) => [project.path, project.name]));
    const threads = Object.fromEntries([...this.known].map(([id, thread]) => {
      const cwd = state.projectOverrides[id] ?? thread.cwd;
      return [id, { cwd, projectName: names.get(cwd) ?? folderName(cwd),
        title: thread.name || thread.preview || guiText("新聊天"),
        running: thread.status?.type === 'active' || Boolean(state.conversations[id]?.activeTurn)
          || state.pendingRequest?.threadId === id }];
    }));
    if (JSON.stringify([threads, state.threadReadState, state.pins])
      === JSON.stringify([this.value.threads, this.value.readState, this.value.pins])
      && this.value.revision >= 0) return this.value;
    this.value = { threads, pins: state.pins, readState: state.threadReadState, revision: this.value.revision + 1 };
    this.listeners.forEach((listener) => listener(this.value));
    return this.value;
  }

  observe(threads: Thread[], since = this.clock) {
    const state = this.binding?.getSnapshot() ?? initialState();
    const readState = { ...state.threadReadState };
    for (const incoming of threads) {
      const known = this.known.get(incoming.id);
      const thread = known && (this.changed.get(incoming.id) ?? 0) > since
        ? { ...incoming, status: known.status, name: known.name ?? incoming.name } : incoming;
      if (!this.binding && this.known.get(thread.id)?.status?.type === 'active' && thread.status?.type !== 'active') {
        readState[thread.id] = { turnId: `refresh:${thread.updatedAt}`, unread: true };
      }
      this.known.set(thread.id, thread);
    }
    if (!this.binding) {
      state.threadReadState = readState;
      savePreferences(state);
    }
    return this.publish(state);
  }

  receive(event: GuiEvent) {
    const { threadId, thread, turn } = event.params;
    if (event.method === 'thread/started' && thread) this.known.set(thread.id, thread);
    else if (event.method === 'thread/deleted' && threadId) this.known.delete(threadId);
    else if (event.method === 'thread/name/updated' && threadId && event.params.threadName !== undefined) {
      const known = this.known.get(threadId);
      if (known) this.known.set(threadId, { ...known, name: event.params.threadName });
    }
    else if (threadId && turn && ['turn/started', 'turn/completed'].includes(event.method)) {
      const known = this.known.get(threadId);
      if (known) this.known.set(threadId, { ...known,
        status: { type: event.method === 'turn/started' ? 'active' : 'idle' } });
      if (!this.binding && event.method === 'turn/completed') {
        const state = initialState();
        if (state.threadReadState[threadId]?.turnId !== turn.id) {
          state.threadReadState[threadId] = { turnId: turn.id, unread: true };
          savePreferences(state);
        }
      }
    } else return;
    const id = threadId ?? thread?.id;
    if (id) this.changed.set(id, ++this.clock);
    this.publish();
  }

  markRead(input: Record<string, unknown>) {
    const { threadId, turnId } = input;
    if (typeof threadId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(threadId)
      || typeof turnId !== 'string' || turnId.length > 200) throw new Error(guiText("聊天已更新，请重新打开。"));
    if (this.binding) this.binding.readState.markRemoteRead(threadId, turnId);
    else {
      const state = initialState();
      if (state.threadReadState[threadId]?.turnId === turnId) {
        state.threadReadState[threadId] = { turnId, unread: false };
        savePreferences(state);
      }
    }
    return this.publish();
  }
}

export const guiSidebar = new SidebarBridge();
