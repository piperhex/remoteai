import type { PaseoAgent, PaseoClient, PaseoAgentUpdate, PaseoAgentListResult } from '@getpaseo/client';
import type { CliChange, CliDirectoryEntry, CliRequest, CliSession, ExternalEngine } from '../../../shared/cli-gui/types';
import { cliKey, cliScope, cliSummary } from '../../../shared/cli-gui/summary';
import { DirectoryJournal } from '../../../shared/chat/directory/journal';
import { DIRECTORY_PAGE_SIZE, validCheckpoint, type DirectoryReply } from '../../../shared/chat/directory/protocol';
import { randomUUID } from 'node:crypto';

type Query = Extract<CliRequest, { action: 'syncList' }>;
interface View {
  engine: ExternalEngine; archived: boolean; search: string;
  journal: DirectoryJournal<CliDirectoryEntry>;
  pending?: Promise<void>;
  touched: Set<string>;
  silent?: boolean;
  subscriptions: Set<{ release(): Promise<void> }>;
  listeners: Set<() => void>;
}
const MAX_VIEWS = 32;

export class CliDirectory {
  private readonly epoch = randomUUID();
  private views = new Map<string, View>();
  private client?: PaseoClient;
  private unsubscribe?: () => void;
  private serial = Promise.resolve();
  constructor(private readonly options: {
    session: (agent: PaseoAgent, engine: ExternalEngine) => Promise<CliSession>;
    changed: (change: CliChange) => void;
  }) {}

  async request(client: PaseoClient, query: Query): Promise<DirectoryReply<CliDirectoryEntry>> {
    if (typeof query.archived !== 'boolean' || (query.search !== undefined
      && (typeof query.search !== 'string' || query.search.length > 1000))) throw new Error('client.cliGui.invalidRequest');
    this.attach(client);
    await this.serial;
    const scope = cliScope(query.engine, query.archived, query.search);
    if (query.checkpoint) {
      const view = this.views.get(query.checkpoint.stream);
      if (!validCheckpoint(query.checkpoint) || query.checkpoint.scope !== scope || !view
        || view.journal.resume(query.checkpoint).kind === 'resetRequired') return { kind: 'resetRequired' };
      if (query.more) await this.load(view);
      return view.journal.resume(query.checkpoint);
    }
    if (this.views.size >= MAX_VIEWS) {
      const oldest = this.views.keys().next().value!;
      this.dispose(this.views.get(oldest)!); this.views.delete(oldest);
    }
    const stream = randomUUID();
    const view: View = { engine: query.engine, archived: query.archived, search: query.search ?? '', touched: new Set(),
      subscriptions: new Set(), listeners: new Set(),
      journal: new DirectoryJournal({ epoch: this.epoch, stream, scope }) };
    this.views.set(stream, view);
    try { await this.load(view); return view.journal.snapshot(); }
    catch (error) { this.dispose(view); this.views.delete(stream); throw error; }
  }

  private attach(client: PaseoClient) {
    if (client === this.client) return;
    this.close(); this.client = client;
    this.unsubscribe = client.agents.subscribe(update => {
      this.serial = this.serial.then(() => this.receive(update)).catch(() => {
        for (const view of this.views.values()) this.dispose(view);
        this.views.clear(); this.options.changed({ invalidated: true });
      });
    });
  }

  private async receive(update: PaseoAgentUpdate) {
    if (update.kind === 'remove') {
      for (const view of this.views.values()) {
        view.touched.add(`${view.engine}:${update.agentId}`);
        this.emit(view, view.journal.commit([], [{ key: `${view.engine}:${update.agentId}`, reason: 'deleted' }]));
      }
      return;
    }
    const agent = update.agent;
    if (agent.labels.remoteai !== 'cli-gui' || !['claude', 'gemini'].includes(agent.provider)) return;
    this.observe(await this.options.session(agent, agent.provider as ExternalEngine));
  }

  observe(session: CliSession) {
    const value = cliSummary(session);
    const key = cliKey(value);
    for (const view of this.views.values()) {
      if (view.engine !== value.engine) continue;
      view.touched.add(key);
      const matching = view.archived === value.archived && `${value.title} ${value.cwd}`.toLowerCase()
        .includes(view.search.toLowerCase());
      this.emit(view, matching ? view.journal.commit([{ key, kind: 'session', value }])
        : view.journal.commit([], [{ key, reason: 'outOfScope' }]));
    }
  }

  private load(view: View): Promise<void> {
    if (view.pending) return view.pending;
    view.silent = true;
    view.pending = this.loadPage(view).finally(() => { view.pending = undefined; view.silent = false; });
    return view.pending;
  }

  private async loadPage(view: View) {
    const previous = view.journal.entries.get('@page');
    if (previous?.kind === 'page' && previous.complete) return;
    let cursor = previous?.kind === 'page' ? previous.cursor ?? undefined : undefined;
    const upserts: CliDirectoryEntry[] = [];
    view.touched.clear();
    const seen = new Set<string>();
    do {
      const page = await this.client!.agents.list({ filter: { labels: { remoteai: 'cli-gui' }, includeArchived: true },
        page: { limit: DIRECTORY_PAGE_SIZE - upserts.length, cursor },
          sort: [{ key: 'updated_at', direction: 'desc' }], subscribe: {} });
      this.observeSubscription(page, view);
      const matching = page.entries.filter(({ agent }) => agent.provider === view.engine
        && Boolean(agent.archivedAt) === view.archived);
      const sessions = await Promise.all(matching.map(({ agent }) => this.options.session(agent, view.engine)));
      await this.serial;
      for (const session of sessions) {
        if (view.touched.has(cliKey(session)) || !`${session.title} ${session.cwd}`.toLowerCase()
          .includes(view.search.toLowerCase())) continue;
        upserts.push({ key: cliKey(session), kind: 'session', value: cliSummary(session) });
      }
      cursor = page.pageInfo.nextCursor ?? undefined;
      if (cursor && seen.has(cursor)) throw new Error('client.cliGui.requestFailed');
      if (cursor) seen.add(cursor);
    } while (cursor && upserts.length < DIRECTORY_PAGE_SIZE);
    upserts.push({ key: '@page', kind: 'page', cursor: cursor ?? null, complete: !cursor });
    this.emit(view, view.journal.commit(upserts));
  }

  private emit(view: View, batch: ReturnType<DirectoryJournal<CliDirectoryEntry>['commit']>) {
    if (batch && !view.silent) this.options.changed({ engine: view.engine, batch });
  }
  private observeSubscription(page: PaseoAgentListResult, view: View) {
    if (!page.subscription) return;
    view.subscriptions.add(page.subscription);
    let initial = true;
    const reset = () => {
      this.views.delete(view.journal.checkpoint().stream); this.dispose(view);
      this.options.changed({ engine: view.engine, invalidated: true });
    };
    view.listeners.add(page.subscription.subscribe({
      snapshot: () => { if (initial) initial = false; else reset(); },
      update: () => {}, // The SDK's global agent-update listener is the single authoritative update path.
      error: reset,
    }));
  }
  close() {
    this.unsubscribe?.(); this.unsubscribe = undefined;
    for (const view of this.views.values()) this.dispose(view);
    this.views.clear(); this.client = undefined;
  }
  private dispose(view: View) {
    for (const unsubscribe of view.listeners) unsubscribe();
    view.listeners.clear();
    for (const subscription of view.subscriptions) {
      // An expired SDK transport already discarded the subscription; local disposal must still finish.
      void subscription.release().catch(() => {});
    }
    view.subscriptions.clear();
  }
}
