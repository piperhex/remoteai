import type { GuiEvent, Thread } from '../../../../shared/conversation/types';
import { guiApi } from '../../../../shared/conversation/api';
import { DIRECTORY_EVENT, validCheckpoint, type DirectoryEvent,
  type DirectoryCheckpoint, type DirectoryReply } from '../../../../shared/chat/directory/protocol';
import { DirectoryJournal } from '../../../../shared/chat/directory/journal';
import { DirectoryIcons } from '../../../../shared/chat/directory/icons';
import { directoryScope, readDirectoryQuery, sidebarEntries, summaryEntry,
  type ChatDirectoryEntry, type DirectoryQuery } from '../../../../shared/chat/directory/documents';
import { memberGroup } from '../../../../shared/chat/groups/model';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';
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
  private grouping = '';

  constructor() { guiSidebar.subscribeCatalog(live => this.changed(live)); }
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
      if (!view || view.journal.resume(checkpoint).kind === 'resetRequired') return { kind: 'resetRequired' };
      view.lastUsed = Date.now();
      if (body.action === 'page') return this.page(view, checkpoint);
      return view.journal.resume(checkpoint);
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
    const catalog = new Map(guiSidebar.catalog().map(row => [row.thread.id, row]));
    const entries: ChatDirectoryEntry[] = [];
    for (const thread of page.data) {
      // A deletion/archive during the read wins over a late page response.
      if ((view.touched.get(thread.id) ?? 0) > since) continue;
      const row = catalog.get(thread.id) ?? { thread, archived: view.query.archived };
      if (this.matches(view, row)) entries.push(summaryEntry(this.present(row.thread)));
    }
    entries.push({ key: '@page', kind: 'page', cursor: page.nextCursor, complete: page.nextCursor === null });
    this.commit(view, entries);
  }

  private present(thread: Thread) {
    const entry = guiSidebar.snapshot().threads[thread.id];
    return entry ? { ...thread, cwd: entry.cwd, name: entry.title,
      status: { type: entry.running ? 'active' : 'idle' } } : thread;
  }

  private matches(view: View, row: CatalogRow) {
    if (row.archived !== view.query.archived) return false;
    const thread = this.present(row.thread);
    const grouping = guiSidebar.snapshot().grouping;
    return !view.query.groupId || !!grouping && memberGroup(grouping,
      { kind: 'thread', id: thread.id, title: thread.name ?? '', cwd: thread.cwd }) === view.query.groupId;
  }

  private changed(live: boolean) {
    const grouping = JSON.stringify(guiSidebar.snapshot().grouping);
    if (this.grouping && grouping !== this.grouping) {
      for (const [id, view] of this.views) {
        if (!view.query.groupId) continue;
        this.listeners.forEach(listener => listener({ method: DIRECTORY_EVENT,
          params: { kind: 'resetRequired', checkpoint: view.journal.checkpoint() } }));
        this.views.delete(id);
      }
    }
    this.grouping = grouping;
    const catalog = new Map(guiSidebar.catalog().map(row => [row.thread.id,
      { ...row, thread: this.present(row.thread) }]));
    const changed = [...catalog].filter(([id, row]) => JSON.stringify(row) !== JSON.stringify(this.previous.get(id)));
    const deleted = [...this.previous.keys()].filter(id => !catalog.has(id));
    const membershipChanged = live && (deleted.length > 0 || changed.some(([id, row]) => {
      const previous = this.previous.get(id);
      return !previous || previous.archived !== row.archived || previous.thread.name !== row.thread.name
        || previous.thread.preview !== row.thread.preview || previous.thread.cwd !== row.thread.cwd;
    }));
    this.previous = catalog;
    const clock = ++this.clock;
    for (const view of this.views.values()) {
      if (view.query.search && membershipChanged) {
        // Search semantics belong to the index, including matches outside the bounded preview DTO.
        this.views.delete(view.journal.checkpoint().stream);
        this.listeners.forEach(listener => listener({ method: DIRECTORY_EVENT,
          params: { kind: 'resetRequired', checkpoint: view.journal.checkpoint() } }));
        continue;
      }
      const upserts: ChatDirectoryEntry[] = [];
      const removals: import('../../../../shared/chat/directory/protocol').DirectoryRemoval[] =
        deleted.map(id => ({ key: `thread:${id}`, reason: 'deleted' }));
      for (const id of deleted) view.touched.set(id, clock);
      for (const [id, row] of changed) {
        if (live) view.touched.set(id, clock);
        const exists = view.journal.entries.has(`thread:${id}`);
        if (this.matches(view, row)) {
          if (exists || live) upserts.push(summaryEntry(row.thread));
        } else if (exists) removals.push({ key: `thread:${id}`, reason: 'outOfScope' });
      }
      for (const entry of view.journal.entries.values()) {
        if (entry.kind !== 'thread') continue;
        const row = catalog.get(entry.value.id);
        if (row && !this.matches(view, row)) removals.push({ key: entry.key, reason: 'outOfScope' });
      }
      this.commit(view, upserts, removals);
    }
  }

  private commit(view: View, entries: ChatDirectoryEntry[], removals: import('../../../../shared/chat/directory/protocol')
    .DirectoryRemoval[] = []) {
    const removedKeys = new Set(removals.map(entry => entry.key));
    const ids = new Set([...view.journal.entries.values(), ...entries].flatMap(entry =>
      entry.kind === 'thread' && !removedKeys.has(entry.key) ? [entry.value.id] : []));
    const metadata = sidebarEntries(guiSidebar.snapshot(), ids, this.icons.reference);
    const keys = new Set(metadata.map(entry => entry.key));
    const stale = [...view.journal.entries.values()].filter(entry => entry.kind !== 'thread'
      && entry.kind !== 'page' && !keys.has(entry.key)).map(entry => ({ key: entry.key, reason: 'outOfScope' as const }));
    const batch = view.journal.commit([...entries, ...metadata], [...removals, ...stale]);
    if (batch && !view.silent) this.listeners.forEach(listener => listener({ method: DIRECTORY_EVENT, params: batch }));
  }

  /** Notifications without summaries fetch only the affected entity, sharing concurrent requests. */
  receive(event: GuiEvent) {
    if (event.method === 'connection/closed' || event.method === 'codex/disconnected') {
      this.invalidate(); this.previous.clear(); return;
    }
    const id = event.params.threadId ?? event.params.thread?.id;
    if (!id || event.method === 'thread/deleted' || !/^(thread\/|turn\/(started|completed))/.test(event.method)) return;
    if (this.previous.has(id) || this.resolving.has(id)) return;
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
