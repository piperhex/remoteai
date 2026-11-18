import { uiText } from "../../../../../shared/localization/uiText";
import type { GuiController } from './controller';
import type { GuiEvent, GuiState, Thread } from '../../../../../shared/conversation/types';
import { initialState, savePreferences } from './preferences';
import { readProjects, folderName } from '../../../../../shared/conversation/projectCatalog';
import { emptySidebar, type SidebarSnapshot, type SidebarThread } from '../../../../../shared/remote-chat/sidebar';
import { threadSummary } from '../../../../../shared/chat/directory/summary';

type Binding = Pick<GuiController, 'getSnapshot' | 'subscribe' | 'readState'>;

export interface CatalogChange { ids: ReadonlySet<string>; live: boolean; global: boolean; grouping: boolean }
const sameValue = <T>(a: T, b: T) => a === b || JSON.stringify(a) === JSON.stringify(b);
function samePresentation(a: SidebarThread | undefined, b: SidebarThread | undefined) {
  return a === b || !!a && !!b && a.cwd === b.cwd && a.projectName === b.projectName
    && a.title === b.title && a.running === b.running;
}

function equalSummary(a: Thread | undefined, b: Thread) {
  return !!a && a.name === b.name && a.preview === b.preview && a.cwd === b.cwd
    && a.updatedAt === b.updatedAt && a.status?.type === b.status?.type;
}

/** Shares the desktop's project labels and read receipts without loading conversation bodies. */
export class SidebarBridge {
  private binding?: Binding;
  private known = new Map<string, Thread>();
  private archived = new Map<string, boolean>();
  private readonly catalogListeners = new Set<(change: CatalogChange) => void>();
  private projects?: ReturnType<typeof readProjects>;
  private overrides?: GuiState['projectOverrides'];
  catalogRow = (id: string) => {
    const thread = this.known.get(id);
    return thread && { thread, archived: this.archived.get(id) ?? false };
  };
  subscribeCatalog = (listener: (change: CatalogChange) => void) => {
    this.catalogListeners.add(listener);
    return () => { this.catalogListeners.delete(listener); };
  };
  private value = emptySidebar();
  private clock = 0;
  private readonly changed = new Map<string, number>();
  private readonly deleted = new Map<string, number>();
  version = () => this.clock;
  snapshot = () => this.value;
  private readonly listeners = new Set<(snapshot: SidebarSnapshot) => void>();

  subscribe = (listener: (snapshot: SidebarSnapshot) => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private remember(thread: Thread, archived?: boolean) {
    const summary = threadSummary(thread);
    const changed = !equalSummary(this.known.get(thread.id), summary);
    if (changed) this.known.set(thread.id, summary);
    if (archived === undefined || archived === (this.archived.get(thread.id) ?? false)) return changed;
    this.archived.set(thread.id, archived);
    return true;
  }

  attach(binding: Binding) {
    this.binding = binding;
    let previous: GuiState | undefined;
    const update = () => {
      const state = binding.getSnapshot();
      if (previous?.threads === state.threads && previous.archived === state.archived
        && previous.threadReadState === state.threadReadState
        && previous.projectOverrides === state.projectOverrides && previous.projects === state.projects
        && previous.pendingRequest === state.pendingRequest && previous.pins === state.pins
        && previous.pinnedProjects === state.pinnedProjects && previous.grouping === state.grouping) return;
      const ids = new Set<string>();
      if (previous?.threads !== state.threads || previous.archived !== state.archived) {
        state.threads.forEach(thread => {
          if (this.remember(thread, state.archived)) ids.add(thread.id);
        });
      }
      for (const id of [previous?.pendingRequest?.threadId, state.pendingRequest?.threadId]) if (id) ids.add(id);
      if (previous?.conversations !== state.conversations) {
        for (const id of new Set([...Object.keys(previous?.conversations ?? {}), ...Object.keys(state.conversations)])) {
          if (previous?.conversations[id]?.activeTurn !== state.conversations[id]?.activeTurn) ids.add(id);
        }
      }
      previous = state;
      this.publish(state, ids);
    };
    update();
    const unsubscribe = binding.subscribe(update);
    return () => { unsubscribe(); if (this.binding === binding) this.binding = undefined; };
  }

  private publish(state = this.binding?.getSnapshot() ?? initialState(), ids = new Set<string>(), live = false) {
    const projects = readProjects();
    if (!sameValue(this.projects, projects) || !sameValue(this.overrides, state.projectOverrides)) {
      for (const id of this.known.keys()) ids.add(id);
    }
    this.projects = projects; this.overrides = state.projectOverrides;
    const names = new Map(projects.map(project => [project.path, project.name]));
    const old = this.value;
    let threads = old.threads;
    for (const id of ids) {
      const thread = this.known.get(id);
      const cwd = state.projectOverrides[id] ?? thread?.cwd ?? '';
      const entry = thread && { cwd, projectName: names.get(cwd) ?? folderName(cwd),
        title: thread.name || thread.preview || uiText("client.chat.newChat"),
        running: thread.status?.type === 'active' || Boolean(state.conversations[id]?.activeTurn)
          || state.pendingRequest?.threadId === id };
      if (samePresentation(old.threads[id], entry)) continue;
      if (threads === old.threads) threads = { ...old.threads };
      if (entry) threads[id] = entry; else delete threads[id];
    }
    const grouping = !sameValue(old.grouping, state.grouping);
    const global = grouping || !sameValue(old.pins, state.pins) || !sameValue(old.pinnedProjects, state.pinnedProjects);
    const reads = old.readState !== state.threadReadState && !sameValue(old.readState, state.threadReadState);
    if (reads) {
      for (const id of new Set([...Object.keys(old.readState), ...Object.keys(state.threadReadState)])) {
        if (!sameValue(old.readState[id], state.threadReadState[id])) ids.add(id);
      }
    }
    if (old.revision < 0 || threads !== old.threads || reads || global) {
      this.value = { threads, pins: state.pins, pinnedProjects: state.pinnedProjects, grouping: state.grouping,
        readState: state.threadReadState, revision: old.revision + 1 };
      this.listeners.forEach(listener => listener(this.value));
    }
    if (ids.size || global) this.catalogListeners.forEach(listener => listener({ ids, live, global, grouping }));
    return this.value;
  }

  observe(threads: Thread[], since = this.clock, archived?: boolean, live = false) {
    const state = this.binding?.getSnapshot() ?? initialState();
    const ids = new Set<string>();
    let readState = state.threadReadState;
    for (const incoming of threads) {
      if ((this.deleted.get(incoming.id) ?? 0) > since) continue;
      const known = this.known.get(incoming.id);
      const thread = known && (this.changed.get(incoming.id) ?? 0) > since
        ? { ...incoming, status: known.status, name: known.name ?? incoming.name } : incoming;
      if (!this.binding && this.known.get(thread.id)?.status?.type === 'active' && thread.status?.type !== 'active') {
        if (readState === state.threadReadState) readState = { ...readState };
        readState[thread.id] = { turnId: `refresh:${thread.updatedAt}`, unread: true };
      }
      const membership = (this.changed.get(thread.id) ?? 0) <= since ? archived : undefined;
      if (this.remember(thread, membership)) ids.add(thread.id);
    }
    if (!this.binding && readState !== state.threadReadState) {
      state.threadReadState = readState;
      savePreferences(state);
    }
    return this.publish(state, ids, live);
  }

  receive(event: GuiEvent) {
    const { threadId, thread, turn } = event.params;
    if (['thread/started', 'thread/resumed'].includes(event.method) && thread) {
      this.known.set(thread.id, threadSummary(thread)); this.archived.set(thread.id, false);
    }
    else if (event.method === 'thread/deleted' && threadId) this.known.delete(threadId);
    else if (['thread/archived', 'thread/unarchived'].includes(event.method) && threadId) {
      this.archived.set(threadId, event.method === 'thread/archived');
    }
    else if (event.method === 'thread/name/updated' && threadId && event.params.threadName !== undefined) {
      const known = this.known.get(threadId);
      if (known) this.known.set(threadId, { ...known, name: event.params.threadName });
    }
    else if (threadId && turn && ['turn/started', 'turn/completed'].includes(event.method)) {
      const known = this.known.get(threadId);
      if (known) this.known.set(threadId, { ...known,
        updatedAt: Math.max(known.updatedAt, turn.completedAt ?? turn.startedAt ?? Math.floor(Date.now() / 1000)),
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
    if (id && event.method === 'thread/deleted') this.deleted.set(id, this.clock);
    this.publish(undefined, new Set(id ? [id] : []), true);
  }

  markRead(input: Record<string, unknown>) {
    const { threadId, turnId } = input;
    if (typeof threadId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(threadId)
      || typeof turnId !== 'string' || turnId.length > 200) throw new Error(uiText("client.conversation.theChatHasChangedPleaseReopenIt"));
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
