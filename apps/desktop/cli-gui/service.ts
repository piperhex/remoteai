import type { PaseoAgent, PaseoAgentHandle, PaseoClient } from '@getpaseo/client';
import type { CliCatalog, CliHistory, CliRequest, ExternalEngine } from '../../../shared/cli-gui/types';
import { CliRuntime } from './runtime';
import { permission, session } from './mapping';
import { CliWorkspaces } from './workspaces';
import { claudeAccountEnvironment, selectedClaudeAccount } from './claudeAccounts';
import { cliRequestEffort } from '../../../shared/cli-gui/modelSelection';
import { cliImages, CliImages } from './images';
import { CliImageHistory } from './imageHistory';

const OWNERSHIP = { remoteai: 'cli-gui' };
const HISTORY_PAGE_SIZE = 100;
// Claude's native replay omits image-only entries. This protocol marker retains the row;
// our saved original text is restored before presentation, including the empty string.
const IMAGE_ONLY_PROMPT = '[image]';

export class CliService {
  private watches = new Map<string, () => void>();
  private mutations = new Map<string, Promise<unknown>>();
  private operations = 0;
  private maintaining = false;
  private workspaces: CliWorkspaces;
  private images: CliImages;
  private imageHistory: CliImageHistory;
  constructor(readonly runtime: Pick<CliRuntime, 'root' | 'status' | 'install' | 'connect' | 'close' | 'accountBridge'>,
    private changed: () => void) {
    this.workspaces = new CliWorkspaces(runtime.root); this.images = new CliImages(runtime.root);
    this.imageHistory = new CliImageHistory(this.images);
  }

  async request(request: CliRequest): Promise<unknown> {
    if (!['claude', 'gemini'].includes(request.engine)) throw new Error('client.cliGui.invalidRequest');
    if (request.action === 'status') return this.runtime.status(request.engine);
    if (request.action === 'install') return this.install(request.engine);
    if (this.maintaining) throw new Error('client.cliGui.busy');
    this.operations++;
    try {
      if ((await this.runtime.status(request.engine)).status === 'installing') throw new Error('client.cliGui.busy');
      return await this.execute(request);
    } finally { this.operations--; }
  }

  private async execute(request: CliRequest) {
    const client = await this.runtime.connect();
    if (request.action === 'catalog') {
      if (request.id) {
        const agent = await this.owned(client, request.engine, request.id);
        const bound = agent.current();
        if (bound?.labels.remoteaiClaudeAccount) {
          // The public SDK does not expose live model changes. Existing native sessions retain their model and account.
          return { status: 'ready', models: [{ id: bound.model, label: bound.model, isDefault: true }], modes: [] };
        }
        return this.catalog(client, request.engine, request.cwd, false);
      }
      return this.catalog(client, request.engine, request.cwd);
    }
    if (request.action === 'list') return this.list(client, request);
    if (request.action === 'create') return this.create(client, request);
    if (request.action === 'read') return this.read(client, request);
    if (request.action === 'image') {
      await this.owned(client, request.engine, request.id);
      return this.images.load(request.id, request.source);
    }
    if (!('id' in request)) throw new Error('client.cliGui.invalidRequest');
    return this.serialized(request.id, async () => {
      const agent = await this.owned(client, request.engine, request.id);
      if (request.action === 'send') {
        await this.send(agent, request);
      } else if (request.action === 'stop') {
        // The public SDK reload operation interrupts the turn and preserves the native session/history.
        await agent.reload();
      } else if (request.action === 'archive') {
        if (agent.status === 'running') throw new Error('client.cliGui.busy');
        await agent.archive();
        this.watches.get(agent.id)?.(); this.watches.delete(agent.id);
      } else if (request.action === 'approve') await this.approve(agent, request);
      this.changed();
      return { ok: true };
    });
  }

  private async send(agent: PaseoAgentHandle, request: Extract<CliRequest, { action: 'send' }>) {
    const images = cliImages(request.images);
    if (typeof request.text !== 'string' || (!request.text.trim() && !images.length)
      || request.text.length > 1_000_000 || typeof request.messageId !== 'string'
      || !request.messageId.trim() || request.messageId.length > 200) throw new Error('client.cliGui.invalidRequest');
    if (agent.archivedAt || agent.status === 'running' || agent.pendingPermissions?.length) {
      throw new Error('client.cliGui.busy');
    }
    await this.watch(agent);
    await this.configureMessage(agent, request);
    if (images.length || await this.images.has(request.id)) {
      const ordinal = await this.imageHistory.nextOrdinal(agent);
      await this.images.save(request.id, request.messageId, { text: request.text, images: request.images ?? [] }, ordinal);
    }
    const text = request.engine === 'claude' && !request.text.trim() ? IMAGE_ONLY_PROMPT : request.text;
    await agent.send(text, { messageId: request.messageId, ...(images.length ? { images } : {}) });
  }

  private async install(engine: ExternalEngine) {
    if (this.maintaining || this.operations) throw new Error('client.cliGui.busy');
    this.maintaining = true;
    try {
      if (this.watches.size) {
        const client = await this.runtime.connect();
        await this.ensureIdle(client);
        for (const unsubscribe of this.watches.values()) unsubscribe();
        this.watches.clear();
      }
      this.runtime.install(engine); return await this.runtime.status(engine);
    } finally { this.maintaining = false; }
  }

  private async ensureIdle(client: PaseoClient) {
    let cursor: string | undefined;
    do {
      const page = await client.agents.list({ filter: { labels: OWNERSHIP }, page: { limit: 200, cursor } });
      if (page.entries.some(entry => entry.agent.status === 'running' || entry.agent.pendingPermissions.length)) {
        throw new Error('client.cliGui.busy');
      }
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
  }

  private async configureMessage(agent: PaseoAgentHandle, request: Extract<CliRequest, { action: 'send' }>) {
    const native = agent.current();
    if (native?.labels.remoteaiClaudeAccount) {
      if (!native.model || request.model && request.model !== native.model) throw new Error('client.cliGui.invalidRequest');
      cliRequestEffort({ id: native.model, label: native.model }, request.effort);
      return;
    }
    const bridge = await this.runtime.accountBridge();
    const routeId = agent.current()?.labels.remoteaiRoute;
    if (!routeId) throw new Error('client.cliGui.accountUnavailable');
    const previous = bridge.selection(routeId);
    const model = request.model ?? previous?.model;
    const models = await bridge.models();
    const chosen = models.find(entry => entry.id === model);
    if (!chosen) throw new Error('client.cliGui.accountUnavailable');
    const effort = cliRequestEffort(chosen,
      request.effort ?? (previous?.model === chosen.id ? previous.effort : undefined));
    await bridge.update(routeId, chosen.id, effort);
  }

  private async session(agent: PaseoAgent, engine: ExternalEngine) {
    if (agent.labels.remoteaiClaudeAccount) {
      return { ...session(agent, engine), cwd: await this.workspaces.display(agent.cwd) };
    }
    const bridge = await this.runtime.accountBridge();
    const route = bridge.selection(agent.labels.remoteaiRoute);
    return { ...session(agent, engine), ...(route ?? {}), cwd: await this.workspaces.display(agent.cwd) };
  }

  private async serialized(id: string, work: () => Promise<unknown>) {
    const previous = this.mutations.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.mutations.set(id, current);
    try { return await current; }
    finally { if (this.mutations.get(id) === current) this.mutations.delete(id); }
  }

  private async owned(client: PaseoClient, engine: ExternalEngine, id: string) {
    if (!/^[\w-]{1,200}$/.test(id)) throw new Error('client.cliGui.invalidRequest');
    const agent = client.agents.ref(id);
    const snapshot = await agent.refresh();
    if (!snapshot || snapshot.agent.provider !== engine || snapshot.agent.labels.remoteai !== OWNERSHIP.remoteai) {
      throw new Error('client.cliGui.invalidRequest');
    }
    return agent;
  }

  private async catalog(client: PaseoClient, engine: ExternalEngine, cwd?: string, useSelection = true): Promise<CliCatalog> {
    cwd = await this.workspaces.directory(cwd);
    await client.providers.refresh({ cwd, providers: [engine] });
    const snapshot = await client.providers.waitForReady({ cwd, timeoutMs: 30_000 });
    const provider = snapshot.entries.find(entry => entry.provider === engine);
    const native = useSelection && engine === 'claude' && await selectedClaudeAccount(this.runtime.root);
    const models = native ? (provider?.models ?? []).map(model => ({
      id: model.id, label: model.label, isDefault: model.isDefault,
    })) : await (await this.runtime.accountBridge()).models();
    return { status: provider?.status ?? 'unavailable', models,
      modes: provider?.modes?.map(mode => ({ id: mode.id, label: mode.label })) ?? [],
    defaultMode: provider?.defaultModeId ?? undefined };
  }

  private async list(client: PaseoClient, request: Extract<CliRequest, { action: 'list' }>) {
    const sessions = [];
    let cursor: string | undefined;
    do {
      const page = await client.agents.list({ filter: { labels: OWNERSHIP, includeArchived: request.archived },
        page: { limit: 200, cursor }, sort: [{ key: 'updated_at', direction: 'desc' }] });
      sessions.push(...await Promise.all(page.entries.filter(entry => entry.agent.provider === request.engine
        && Boolean(entry.agent.archivedAt) === request.archived).map(entry => this.session(entry.agent, request.engine))));
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    return sessions;
  }

  private async create(client: PaseoClient, request: Extract<CliRequest, { action: 'create' }>) {
    const discoveryCwd = await this.workspaces.directory(request.cwd);
    const catalog = await this.catalog(client, request.engine, discoveryCwd);
    const chosen = catalog.models.find(model => model.id === request.model);
    if (!chosen
      || request.mode && !catalog.modes.some(mode => mode.id === request.mode)) {
      throw new Error('client.cliGui.unavailable');
    }
    const effort = cliRequestEffort(chosen, request.effort);
    const binding = request.engine === 'claude' ? await selectedClaudeAccount(this.runtime.root) : null;
    if (binding) {
      const agent = await client.agents.create({ cwd: await this.workspaces.directory(request.cwd, true),
        labels: { ...OWNERSHIP, remoteaiClaudeAccount: binding.id }, env: claudeAccountEnvironment(binding),
        config: { provider: `claude/${request.model}`, modeId: request.mode } });
      const snapshot = await agent.refresh();
      if (!snapshot) throw new Error('client.cliGui.connectionFailed');
      await this.watch(agent); this.changed();
      return this.session(snapshot.agent, request.engine);
    }
    const bridge = await this.runtime.accountBridge();
    const routeId = await bridge.route(request.model, effort);
    const providers = await client.providers.waitForReady({ cwd: discoveryCwd, timeoutMs: 30_000 });
    const nativeModels = providers.entries.find(entry => entry.provider === request.engine)?.models ?? [];
    const nativeModel = nativeModels.find(model => model.isDefault)?.id ?? nativeModels[0]?.id;
    if (!nativeModel) throw new Error('client.cliGui.unavailable');
    // CLI model aliases stay native; the private bridge selects the actual account model.
    const cwd = await this.workspaces.directory(request.cwd, true);
    const agent = await client.agents.create({ cwd,
      labels: { ...OWNERSHIP, remoteaiRoute: routeId }, env: bridge.environment(request.engine, routeId),
      config: { provider: `${request.engine}/${nativeModel}`, modeId: request.mode } });
    const snapshot = await agent.refresh();
    if (!snapshot) throw new Error('client.cliGui.connectionFailed');
    await this.watch(agent);
    this.changed();
    return this.session(snapshot.agent, request.engine);
  }

  private async watch(agent: PaseoAgentHandle) {
    if (this.watches.has(agent.id)) return;
    const unsubscribe = agent.timeline.subscribe(() => this.changed());
    this.watches.set(agent.id, unsubscribe);
    try { await unsubscribe.ready; }
    catch (error) { unsubscribe(); this.watches.delete(agent.id); throw error; }
  }

  private async read(client: PaseoClient, request: Extract<CliRequest, { action: 'read' }>): Promise<CliHistory> {
    const agent = await this.owned(client, request.engine, request.id);
    if (!agent.archivedAt) await this.watch(agent);
    const page = await agent.timeline.refetch({ direction: request.cursor ? 'before' : undefined,
      cursor: request.cursor, limit: HISTORY_PAGE_SIZE, projection: 'projected' });
    if (page.error || !page.agent) throw new Error('client.cliGui.historyFailed');
    return { session: await this.session(page.agent, request.engine),
      entries: await this.imageHistory.entries(agent, page),
      cursor: page.startCursor ?? undefined, hasOlder: page.hasOlder };
  }

  private async approve(agent: PaseoAgentHandle, request: Extract<CliRequest, { action: 'approve' }>) {
    const pending = agent.pendingPermissions?.find(value => value.id === request.permissionId);
    if (!pending) throw new Error('client.cliGui.approvalExpired');
    const action = permission(pending).actions.find(value => value.id === request.actionId);
    if (!action) throw new Error('client.cliGui.invalidRequest');
    const selectedActionId = pending.actions?.length ? action.id : undefined;
    const response = action.behavior === 'allow' ? { behavior: 'allow' as const, selectedActionId,
      ...(request.answers ? { updatedInput: { ...pending.input, answers: request.answers } } : {}) }
      : { behavior: 'deny' as const, selectedActionId };
    await agent.respondToPermission({ requestId: pending.id, response });
  }

  async close() {
    for (const unsubscribe of this.watches.values()) unsubscribe();
    this.watches.clear();
    await this.runtime.close();
  }
}
