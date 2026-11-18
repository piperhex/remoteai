import type { GuiEvent, Thread } from '../../../../shared/conversation/types';
import { guiApi } from '../../../../shared/conversation/api';
import { DIRECTORY_EVENT, validCheckpoint, type DirectoryEvent,
  type DirectoryCheckpoint, type DirectoryRemoval, type DirectoryReply } from '../../../../shared/chat/directory/protocol';
import { DirectoryJournal } from '../../../../shared/chat/directory/journal';
import { DirectoryIcons } from '../../../../shared/chat/directory/icons';
import { directoryScope, readDirectoryQuery, sidebarEntries, sidebarThreadEntries, summaryEntry,
  type ChatDirectoryEntry, type DirectoryQuery } from '../../../../shared/chat/directory/documents';
import { memberGroup } from '../../../../shared/chat/groups/model';
import { guiSidebar, type CatalogChange } from '../pages/codexGui/sidebarBridge';
import { readRemoteThreadList } from './threadList';

const MAX_VIEWS = 64;
interface View {
  query: DirectoryQuery;
  journal: DirectoryJournal<ChatDirectoryEntry>;
  touched: Map<string, number>;
  pending?: Promise<DirectoryReply<ChatDirectoryEntry>>;
  lastUsed: number;
  silent?: boolean;
}
type CatalogRow = { thread: Thread; archived: boolean };
type Publish = (event: { method: string; params: DirectoryEvent<ChatDirectoryEntry> }) => void;

/** Host lifetime, not connection lifetime: reconnecting and changing paths preserve retained logs. */
export class ChatDirectory {
  private readonly epoch = crypto.randomUUID();
  private readonly views = new Map<string, View>();
  private readonly listeners = new Set<Publish>();
  private readonly icons = new DirectoryIcons();
  private previous = new Map<string, CatalogRow>();
  private readonly resolving = new Map<string, Promise<void>>();
  private clock = 0;

  constructor() { guiSidebar.subscribeCatalog(change => this.changed(change)); }
  subscribe(listener: Publish) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  async request(body: Record<string, unknown>): Promise<DirectoryReply<ChatDirectoryEntry> | { source?: string }> {
    if (body.action === 'icon') {
      if (typeof body.reference !== 'string' || !/^chat-icon:[a-f0-9]{64}$/.test(body.reference)) {
        throw new Error('Invalid request');
      }
      return { source: this.icons.get(body.reference) };
    }
    const query = readDirectoryQuery(body.query);
    if (body.force === true && body.action === 'sync') return this.create(query, true);
    const checkpoint = body.checkpoint;
    if (checkpoint !== undefined) {
      if (!validCheckpoint(checkpoint) || checkpoint.scope !== directoryScope(query)) return { kind: 'resetRequired' };
      const view = this.views.get(checkpoint.stream);
      if (!view) return { kind: 'resetRequired' };
      const replay = view.journal.resume(checkpoint);
      if (replay.kind === 'resetRequired') return replay;
      view.lastUsed = Date.now();
      if (body.action === 'page') return this.page(view, checkpoint);
      return replay;
    }
    if (body.action !== 'sync') throw new Error('Invalid request');
    return this.create(query);
  }

  private async create(query: DirectoryQuery, force = false): Promise<DirectoryReply<ChatDirectoryEntry>> {
    this.prune();
    const stream = crypto.randomUUID();
    const view: View = { query, touched: new Map(), lastUsed: Date.now(),
      silent: true,
      journal: new DirectoryJournal({ epoch: this.epoch, stream, scope: directoryScope(query) }) };
    this.views.set(stream, view);
    try {
      await this.load(view, undefined, force);
      view.silent = false;
      return view.journal.snapshot();
    } catch (error) { this.views.delete(stream); throw error; }
  }

  private page(view: View, checkpoint: DirectoryCheckpoint): Promise<DirectoryReply<ChatDirectoryEntry>> {
    if (view.pending) return view.pending.then(() => view.journal.resume(checkpoint));
    const entry = view.journal.entries.get('@page');
    if (entry?.kind !== 'page' || !entry.cursor) return Promise.resolve(view.journal.resume(checkpoint));
    view.silent = true;
    view.pending = this.load(view, entry.cursor).then(() => view.journal.resume(checkpoint))
      .finally(() => { view.pending = undefined; view.silent = false; });
    return view.pending;
  }

  private async load(view: View, cursor?: string, force = false) {
    const since = this.clock;
    const sidebarVersion = guiSidebar.version();
    const page = await readRemoteThreadList({ ...view.query, cursor, directory: true, force });
    guiSidebar.observe(page.data, sidebarVersion, view.query.archived);
    const entries: ChatDirectoryEntry[] = [];
    for (const thread of page.data) {
      // A deletion/archive during the read wins over a late page response.
      if ((view.touched.get(thread.id) ?? 0) > since) continue;
      const row = guiSidebar.catalogRow(thread.id);
      if (!row) continue;
      const presented = { ...row, thread: this.present(row.thread) };
      this.previous.set(thread.id, presented);
      if (this.matches(view, presented)) entries.push(summaryEntry(presented.thread));
    }
    entries.push({ key: '@page', kind: 'page', cursor: page.nextCursor, complete: page.nextCursor === null });
    view.touched.clear();
    if (cursor) this.commitThreads(view, new Set(page.data.map(thread => thread.id)), { upserts: entries, removals: [] });
    else this.commit(view, entries);
  }

  private present(thread: Thread) {
    const entry = guiSidebar.snapshot().threads[thread.id];
    return entry ? { ...thread, cwd: entry.cwd, name: entry.title,
      status: { type: entry.running ? 'active' : 'idle' } } : thread;
  }

  private matches(view: View, row: CatalogRow) {
    if (row.archived !== view.query.archived) return false;
    const thread = row.thread;
    const grouping = guiSidebar.snapshot().grouping;
    return !view.query.groupId || !!grouping && memberGroup(grouping,
      { kind: 'thread', id: thread.id, title: thread.name ?? '', cwd: thread.cwd }) === view.query.groupId;
  }

  private changed(change: CatalogChange) {
    const updates = new Map<string, CatalogRow | undefined>();
    let membership = false;
    for (const id of change.ids) {
      const raw = guiSidebar.catalogRow(id);
      const row = raw && { ...raw, thread: this.present(raw.thread) };
      const before = this.previous.get(id);
      if (!row && !before) continue;
      if (row && before && row.archived === before.archived && row.thread.name === before.thread.name
        && row.thread.cwd === before.thread.cwd && row.thread.preview === before.thread.preview
        && row.thread.updatedAt === before.thread.updatedAt && row.thread.status?.type === before.thread.status?.type) {
        continue;
      }
      if (row) this.previous.set(id, row); else this.previous.delete(id);
      updates.set(id, row);
      if (!row || !before || row.archived !== before.archived || row.thread.name !== before.thread.name
        || row.thread.preview !== before.thread.preview || row.thread.cwd !== before.thread.cwd) membership = true;
    }
    const clock = ++this.clock;
    for (const [id, view] of this.views) {
      if (view.query.groupId && change.grouping || view.query.search && change.live && membership) {
        this.views.delete(id);
        this.listeners.forEach(listener => listener({ method: DIRECTORY_EVENT,
          params: { kind: 'resetRequired', checkpoint: view.journal.checkpoint() } }));
        continue;
      }
      const upserts: ChatDirectoryEntry[] = [];
      const removals: DirectoryRemoval[] = [];
      for (const [threadId, row] of updates) {
        if (view.silent && change.live) view.touched.set(threadId, clock);
        const key = `thread:${threadId}`;
        if (!row) removals.push({ key, reason: 'deleted' });
        else if (this.matches(view, row)) {
          if (change.live || view.journal.entries.has(key)) upserts.push(summaryEntry(row.thread));
        } else if (view.journal.entries.has(key)) removals.push({ key, reason: 'outOfScope' });
      }
      if (change.global) this.commit(view, upserts, removals);
      else this.commitThreads(view, change.ids, { upserts, removals });
    }
  }

  private commitThreads(view: View, ids: ReadonlySet<string>,
    { upserts, removals }: { upserts: ChatDirectoryEntry[]; removals: DirectoryRemoval[] }) {
    const sidebar = guiSidebar.snapshot();
    const added = new Set(upserts.map(entry => entry.key));
    const removed = new Set(removals.map(entry => entry.key));
    upserts.push({ key: '@metadata', kind: 'metadata', revision: sidebar.revision });
    for (const id of ids) {
      const key = `thread:${id}`;
      const loaded = added.has(key) || !removed.has(key) && view.journal.entries.has(key);
      const metadata = loaded ? sidebarThreadEntries(sidebar, id) : [];
      upserts.push(...metadata);
      for (const kind of ['presentation', 'read', 'groupThread']) {
        const key = `${kind}:${id}`;
        if (view.journal.entries.has(key) && !metadata.some(entry => entry.key === key)) {
          removals.push({ key, reason: 'outOfScope' });
        }
      }
    }
    this.publish(view, upserts, removals);
  }

  private commit(view: View, entries: ChatDirectoryEntry[], removals: DirectoryRemoval[] = []) {
    const removedKeys = new Set(removals.map(entry => entry.key));
    const ids = new Set([...view.journal.entries.values(), ...entries].flatMap(entry =>
      entry.kind === 'thread' && !removedKeys.has(entry.key) ? [entry.value.id] : []));
    const metadata = sidebarEntries(guiSidebar.snapshot(), ids, this.icons.reference);
    const keys = new Set(metadata.map(entry => entry.key));
    const stale = [...view.journal.entries.values()].filter(entry => entry.kind !== 'thread'
      && entry.kind !== 'page' && !keys.has(entry.key)).map(entry => ({ key: entry.key, reason: 'outOfScope' as const }));
    this.publish(view, [...entries, ...metadata], [...removals, ...stale]);
  }

  private publish(view: View, upserts: ChatDirectoryEntry[], removals: DirectoryRemoval[]) {
    const batch = view.journal.commit(upserts, removals);
    if (batch && !view.silent) this.listeners.forEach(listener => listener({ method: DIRECTORY_EVENT, params: batch }));
  }

  /** Notifications without summaries fetch only the affected entity, sharing concurrent requests. */
  receive(event: GuiEvent) {
    if (event.method === 'connection/closed' || event.method === 'codex/disconnected') {
      this.invalidate(); this.previous.clear(); return;
    }
    const id = event.params.threadId ?? event.params.thread?.id;
    if (!id || event.method === 'thread/deleted' || !/^(thread\/|turn\/(started|completed))/.test(event.method)) return;
    if (guiSidebar.catalogRow(id) || this.resolving.has(id)) return;
    const since = guiSidebar.version();
    const pending = Promise.all([false, true].map(async archived => {
      const threads = await guiApi.request<Thread[]>({ operation: 'groupThreadSummaries', threadIds: [id], archived });
      if (threads.length) guiSidebar.observe(threads, since, archived, true);
    })).then(() => undefined).catch(() => {
      // No checkpoint can certify missing state. A later request gets one bounded replacement snapshot.
      this.invalidate();
    }).finally(() => { this.resolving.delete(id); });
    this.resolving.set(id, pending);
  }

  private invalidate() {
    const views = [...this.views.values()];
    this.views.clear();
    for (const view of views) this.listeners.forEach(listener => listener({ method: DIRECTORY_EVENT,
      params: { kind: 'resetRequired', checkpoint: view.journal.checkpoint() } }));
  }

  private prune() {
    if (this.views.size < MAX_VIEWS) return;
    const oldest = [...this.views].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (oldest) this.views.delete(oldest[0]);
  }
}

export const chatDirectory = new ChatDirectory();
