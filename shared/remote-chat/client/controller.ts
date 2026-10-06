import type { ChatConnection, ConnectionEvents } from './connection';
import { mergeTaskDelivery } from '../taskDelivery';
import type { RemoteComposerCatalog } from '../composerCatalog';
import type { ProjectFilesRequest, ProjectFilesResponse } from '../projectFiles';
import { applyChatEvent } from './events';
import { syncChatProcessing } from './processing';
import { mergeHistory } from './history';
import { HISTORY_CHANGED } from '../historySync';
import { contentStringHash } from '../stringHash';
import type { HistoryPage } from '../historyPage';
import { HistoryReader } from './historyReader';
import type { HistoryVersionSource } from './historyPreparation';
import { HistoryCache } from './historyCache';
import { ImageCache } from './imageCache';
import { ThreadActions, threadMutationPatch, type ThreadMutation } from './threadActions';
import { OfflineWriter, type OfflineHistoryStore } from './offline';
import { offlineImage } from './offlineImages';
import { validateChatImages } from '../attachments';
import { hasUpload } from '../uploadProgress';
import { compactUnavailableReason } from './composerCommands';
import type { ConnectionMode } from '../protocol';
import { chatApprovals, chatHandshake } from '../handshake';
import { CONNECTION_ERRORS, guiConnectionError } from '../connectionErrors';
import { COMPOSER_EVENT, type ComposerSettings, type ComposerSnapshot } from '../composer';
import { RemoteComposerSettings } from './composerSettings';
import { RemoteGoals } from './goals';
import { SIDEBAR_EVENT, type SidebarSnapshot } from '../sidebar';
import { emptyQueue, QUEUE_EVENT, type QueueAction, type QueueSnapshot } from '../queue';
import { QueueConnection } from './queueConnection';
import { AsyncAnswers } from './asyncAnswers';
import { createGuiAccountsClient } from './guiAccounts';
import { createContextSettingsClient } from './contextSettings';
import { createGuiToolsClient } from '../guiTools';
import type { UsageSummary } from '../usage';
import { TOKEN_SUMMARY_OPERATION, type ReadTokenSummary } from '../tokenSummary';
import { decodeTokenSummary, QUOTA_HISTORY_FORMAT, type TokenSummaryResponse } from '../tokenSummaryCodec';
import { initialChatState, type ApprovalReply, type ChatProject, type ChatState, type GuiEvent,
  type ListResponse, type Request, type SendInput, type SkillsResponse, type Thread } from './types';

const SYNCHRONIZATION_RETRY_MS = 3000;

export class ChatController {
  readonly threadActions = new ThreadActions({ snapshot: () => this.state, update: patch => this.update(patch),
    request: body => this.connection.request('request', body), complete: body => this.completeThreadMutation(body),
    refresh: () => this.list() });
  readonly goals = new RemoteGoals({ snapshot: () => this.state, update: (patch) => this.update(patch),
    request: (body) => this.request(body), created: (id, settings) => this.composer.created(id, settings),
    generation: () => this.synchronization });
  private state = initialChatState();
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: GuiEvent) => void>();
  private readonly connection: Pick<ChatConnection, 'request' | 'start' | 'stop'>
    & Partial<Pick<ChatConnection, 'confirmHostIdentity' | 'reportDiagnostic' | 'retryNow' | 'openNativeMedia'
      | 'downloadsBulk' | 'setBulkSupport'>>;
  private readonly queueConnection = new QueueConnection((body) => this.connection.request('request', body));
  private readonly asyncAnswers = new AsyncAnswers({ snapshot: () => this.state,
    request: (body) => this.connection.request('request', body), update: (patch) => this.update(patch),
    applyQueue: (queue) => this.applyQueue(queue), refresh: () => this.refreshSelected() });
  readonly guiAccounts = createGuiAccountsClient({
    request: (body) => this.connection.request('request', body), subscribe: (listener) => this.subscribeEvents(listener),
  });
  readonly guiTools = createGuiToolsClient(<T>(body: object) => this.connection.request<T>('request', body),
    (event, fields) => this.connection.reportDiagnostic?.(event, fields),
    viewId => this.connection.openNativeMedia?.(viewId) ?? Promise.resolve(undefined));
  private listGeneration = 0;
  private readGeneration = 0;
  private refreshThreadId: string | null = null;
  private synchronization = 0;
  private synchronizing?: number;
  private skillGeneration = 0;
  private active = false;
  private transportConnected = false;
  private syncTimer?: ReturnType<typeof setTimeout>;
  private readonly images = new ImageCache(<T>(body: Parameters<ConstructorParameters<typeof ImageCache>[0]>[0]) =>
    this.connection.request<T>('request', body));
  private readonly histories = new HistoryCache();
  private readonly historyReader: HistoryReader;
  private readonly historyPages = new Map<string, HistoryPage>();
  private historyTimer?: ReturnType<typeof setTimeout>;
  private historyDirty = false;
  private olderQueued = false;
  private readonly composer = new RemoteComposerSettings({ snapshot: () => this.state,
    update: (patch) => this.update(patch), ready: () => this.active && this.state.ready,
    request: (body) => this.connection.request('request', body) });
  private viewing = true;
  private loadedThreadId: string | null = null;
  private readonly reading = new Set<string>();

  private readonly offlineWriter?: OfflineWriter;
  private cacheStarted = false;
  private cacheFailure = () => {
    if (!this.state.cacheError) this.update({ cacheError: '部分内容未能缓存，连接电脑后可继续查看。' });
  };

  constructor(createConnection: (events: ConnectionEvents) => Pick<ChatConnection, 'request' | 'start' | 'stop'>
    & Partial<Pick<ChatConnection, 'confirmHostIdentity' | 'reportDiagnostic' | 'retryNow'
      | 'downloadsBulk' | 'setBulkSupport'>>,
    private readonly offline?: OfflineHistoryStore, versions?: HistoryVersionSource) {
    this.historyReader = new HistoryReader((body) => this.connection.request('request', body), versions);
    if (offline) this.offlineWriter = new OfflineWriter(offline, this.cacheFailure);
    this.connection = createConnection({
      mode: (mode) => this.changeMode(mode), error: (error) => this.update({ error, connectionIssue: error }),
      stage: (connectionStage) => this.update({ connectionStage }),
      publicEndpoints: (publicEndpoints) => this.update({ publicEndpoints }),
      directEndpoints: (directEndpoints) => this.update({ directEndpoints }),
      delivery: (value) => {
        const turn = this.state.selected?.id === value.threadId ? this.state.selected.turns?.at(-1) : undefined;
        const receipt = value.phase === 'sending' ? { ...value, afterTurnId: turn?.id,
          afterUserCount: turn?.items.filter(item => item.type === 'userMessage').length ?? 0 } : value;
        this.update({ deliveries: { ...this.state.deliveries,
          [value.threadId]: mergeTaskDelivery(this.state.deliveries?.[value.threadId], receipt) } });
      },
      ready: () => { void this.synchronize(); },
      // Resuming the coordinator socket must not replace a pending GUI initialization deadline.
      retryAt: (retryAt) => { if (!this.transportConnected) this.update({ retryAt }); },
      event: (event) => this.receive(event as GuiEvent),
      upload: (upload) => { if (this.state.sending) this.update({ upload }); },
    });
    this.downloads.bulk = this.connection.downloadsBulk;
  }

  snapshot = () => this.state;
  readUsage = () => this.connection.request<UsageSummary>('request', { operation: 'usageSummary' });
  readonly contextSettings = createContextSettingsClient(<T>(body: unknown) =>
    this.connection.request<T>('request', body));
  readTokenSummary: ReadTokenSummary = (weeks) =>
    this.connection.request<TokenSummaryResponse>('request', {
      operation: TOKEN_SUMMARY_OPERATION, weeks, quotaHistoryFormat: QUOTA_HISTORY_FORMAT,
    }).then(decodeTokenSummary);
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  subscribeEvents = (listener: (event: GuiEvent) => void) => {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  };
  private emit() {
    const { selected, ready, historyOffline, selectedArchived } = this.state;
    if (ready && selected && !historyOffline && this.loadedThreadId === selected.id) {
      this.offlineWriter?.remember({ thread: selected, archived: selectedArchived,
        page: this.historyPages.get(selected.id) ?? { hasMore: false } });
    }
    for (const listener of this.listeners) listener();
  }
  private update(patch: Partial<ChatState>) {
    this.state = syncChatProcessing({ ...this.state, ...patch }, this.state);
    this.emit();
  }
  private request<T>(body: Request) { return this.connection.request<T>('request', body); }
  private failure(error: unknown) {
    this.update({ error: error instanceof Error ? error.message : '操作未完成，请稍后重试。' });
  }

  private changeMode(mode: ConnectionMode) {
    // A path outage keeps the logical session, pending requests and loaded history intact.
    if (mode !== 'offline' && this.transportConnected) {
      this.update({ mode });
      // A failed initialization cannot schedule a retry while all paths are down.
      // Resuming transport v2 preserves the session and does not emit ready again.
      if (!this.state.ready && this.synchronizing !== this.synchronization) this.scheduleSynchronization();
      return;
    }
    this.transportConnected = mode === 'direct' || mode === 'relay';
    this.historyReader.reset();
    this.queueConnection.reset();
    if (mode === 'offline') {
      this.skillGeneration += 1;
      this.composer.reset();
      this.update({ sidebar: { ...this.state.sidebar, revision: -1 } });
      this.update({ queue: { ...this.state.queue, revision: -1 } });
    }
    this.synchronization += 1;
    this.listGeneration += 1;
    this.readGeneration += 1;
    this.refreshThreadId = null;
    this.olderQueued = false;
    clearTimeout(this.syncTimer);
    clearTimeout(this.historyTimer);
    this.historyTimer = undefined;
    this.update({ mode, ready: false, connecting: mode !== 'offline', retryAt: null,
      historyOffline: this.offline && this.state.selected ? true : this.state.historyOffline,
      loading: false, historyLoading: false, historyLoadingMore: false, compacting: undefined });
    if (this.offline) void this.flushCache().then(() => this.listOffline());
  }

  private receive(event: GuiEvent) {
    if (!event?.params || typeof event.method !== 'string') return;
    for (const listener of this.eventListeners) listener(event);
    if (event.method === 'thread/deleted' && event.params.threadId) {
      this.completeThreadMutation({ operation: 'delete', threadId: event.params.threadId });
    }
    if (event?.method === HISTORY_CHANGED) {
      if (event.params.threadId === this.state.selected?.id) this.scheduleHistory();
      if (event.params.reason?.startsWith('thread/')
        || !this.state.threads.some((thread) => thread.id === event.params.threadId)) void this.list();
      return;
    }
    if (event?.method === COMPOSER_EVENT) { this.composer.receive(event.params as unknown as ComposerSnapshot); return; }
    if (event?.method === SIDEBAR_EVENT) { this.applySidebar(event.params as unknown as SidebarSnapshot); return; }
    if (event?.method === QUEUE_EVENT) { this.applyQueue(event.params as unknown as QueueSnapshot); return; }
    this.state = applyChatEvent(this.state, event);
    this.emit();
    this.markViewed();
    if (event?.method === 'turn/completed' && event.params.threadId === this.state.selected?.id) {
      this.scheduleHistory();
    }
    if (['thread/name/updated', 'thread/archived', 'thread/unarchived', 'thread/deleted'].includes(event?.method)) {
      void this.list();
      if (event.params.threadId === this.state.selected?.id) this.scheduleHistory();
    }
    if (event?.method === 'connection/closed' || event?.method === 'codex/disconnected') {
      this.skillGeneration += 1;
      this.synchronization += 1;
      this.update({ ready: false, connecting: false, error: CONNECTION_ERRORS.guiDisconnected,
        connectionIssue: CONNECTION_ERRORS.guiDisconnected });
      this.scheduleSynchronization();
    }
  }

  private scheduleSynchronization() {
    clearTimeout(this.syncTimer);
    if (!this.active || !['direct', 'relay'].includes(this.state.mode)) return;
    this.update({ retryAt: Date.now() + SYNCHRONIZATION_RETRY_MS });
    this.syncTimer = setTimeout(() => { void this.synchronize(); }, SYNCHRONIZATION_RETRY_MS);
  }

  private scheduleHistory() {
    this.historyDirty = true;
    if (this.historyTimer || this.refreshThreadId || !this.active) return;
    this.historyTimer = setTimeout(() => {
      this.historyTimer = undefined;
      void this.refreshSelected();
    }, 100);
  }

  start() {
    this.active = true;
    if (this.offline && !this.cacheStarted) { this.cacheStarted = true; void this.listOffline(); }
    this.connection.start();
  }

  flushCache = () => this.offlineWriter?.flush() ?? Promise.resolve();

  private async listOffline() {
    if (!this.offline) return;
    const generation = this.listGeneration;
    try {
      const cached = await this.offline.list();
      if (!this.active || generation !== this.listGeneration || this.state.ready) return;
      const { archived, search } = this.state;
      const threads = cached.filter((value) => value.archived === archived
        && `${value.thread.name ?? ''} ${value.thread.preview}`.toLowerCase().includes(search.toLowerCase()))
        .map((value) => value.thread);
      this.update({ threads, cachedThreadIds: cached.map((value) => value.thread.id), cursor: null });
    } catch { this.cacheFailure(); }
  }

  confirmHostIdentity = async (fingerprint: string) => {
    if (!this.connection.confirmHostIdentity) throw new Error('当前连接无法更新电脑身份。');
    await this.connection.confirmHostIdentity(fingerprint);
    this.connectNow();
  };

  connectNow = () => {
    this.active = true;
    this.connection.retryNow?.();
    if (this.state.ready || this.state.connecting) return;
    if (this.transportConnected) { void this.synchronize(); return; }
    this.connection.stop();
    this.update({ connecting: true, retryAt: null, error: '' });
    this.connection.start();
  };

  stop() {
    this.previewDownloads?.dispose();
    void this.flushCache();
    this.active = false;
    this.composer.reset();
    this.skillGeneration += 1;
    this.historyReader.reset();
    this.queueConnection.reset();
    this.olderQueued = false;
    clearTimeout(this.syncTimer);
    clearTimeout(this.historyTimer);
    this.historyTimer = undefined;
    this.synchronization += 1;
    this.listGeneration += 1;
    this.readGeneration += 1;
    this.refreshThreadId = null;
    this.update({ ready: false, connecting: false, retryAt: null,
      historyLoading: false, historyLoadingMore: false, compacting: undefined });
    this.connection.stop();
  }

  private async synchronize() {
    if (!this.active || this.synchronizing === this.synchronization) return;
    clearTimeout(this.syncTimer);
    const generation = ++this.synchronization;
    this.synchronizing = generation;
    this.update({ connecting: true, retryAt: null, connectionStage: 'chat' });
    try {
      const response = await this.connection.request<unknown>('connect', chatHandshake);
      if (!this.active || generation !== this.synchronization) return;
      const approvals = chatApprovals(response);
      this.previewDownloadSupported = !!response && typeof response === 'object'
        && 'filePreviewsV1' in response && response.filePreviewsV1 === true;
      this.connection.setBulkSupport?.(response);
      if (response && typeof response === 'object' && 'desktopOnly' in response && response.desktopOnly === true) {
        this.update({ desktopOnly: true, approvals: [], selected: null, threads: [], queue: emptyQueue(),
          ready: true, connecting: false, retryAt: null, error: '', connectionStage: 'ready', connectionIssue: '' });
        return;
      }
      this.update({ desktopOnly: false });
      this.update({ approvals, error: '' });
      // A disk read begun during connection must not delay or replace the authoritative refresh.
      if (this.offline && this.state.historyLoading) {
        this.readGeneration += 1;
        this.refreshThreadId = null;
      }
      await Promise.all([this.list(), this.composer.load(), this.refreshSelected(), this.loadQueue(generation)]);
      if (this.active && generation === this.synchronization) {
        this.update({ ready: true, connecting: false, retryAt: null, connectionStage: 'ready', connectionIssue: '' });
        this.composer.retry();
      }
    } catch (error) {
      if (!this.active || generation !== this.synchronization) return;
      this.update({ connecting: false, error: guiConnectionError(error), connectionIssue: guiConnectionError(error) });
      this.scheduleSynchronization();
    } finally { if (this.synchronizing === generation) this.synchronizing = undefined; }
  }

  private applySidebar(sidebar?: SidebarSnapshot) {
    if (!sidebar || !Number.isSafeInteger(sidebar.revision) || sidebar.revision < this.state.sidebar.revision
      || !sidebar.threads || !sidebar.readState) return;
    this.update({ sidebar });
    this.markViewed();
  }

  private applyQueue(queue: QueueSnapshot) {
    if (!queue || !Number.isSafeInteger(queue.revision) || queue.revision < this.state.queue.revision
      || !queue.threads) return;
    this.update({ queue });
  }

  private async loadQueue(generation: number) {
    const queue = await this.queueConnection.read();
    if (generation !== this.synchronization) return;
    if (queue) this.applyQueue(queue);
    else this.update({ queue: emptyQueue() });
  }

  async queueAction(operation: QueueAction, id?: string) {
    const threadId = this.state.selected?.id;
    if (!threadId || !this.state.ready || this.state.queueBusy) return;
    const generation = this.synchronization;
    this.update({ queueBusy: true, error: '' });
    try {
      const queue = await this.connection.request<QueueSnapshot>('request', { operation, threadId, id });
      if (generation === this.synchronization) this.applyQueue(queue);
      void this.refreshSelected();
    } catch (error) { this.failure(error); }
    finally { this.update({ queueBusy: false }); }
  }

  async takeQueuedMessage(id: string) {
    const threadId = this.state.selected?.id;
    if (!threadId || !this.state.ready || this.state.queueBusy || this.state.sending) return;
    const generation = this.synchronization;
    this.update({ queueBusy: true, error: '' });
    try {
      const result = await this.connection.request<import('../queue').QueueEditResult>('request', {
        operation: 'queueEdit', threadId, id,
      });
      const { draft, ...queue } = result;
      if (generation === this.synchronization) this.applyQueue(queue);
      return draft;
    } catch (error) { this.failure(error); }
    finally { this.update({ queueBusy: false }); }
  }

  setViewing(viewing: boolean) { this.viewing = viewing; this.markViewed(); }

  private markViewed() {
    const thread = this.state.selected;
    if (!this.active || !this.viewing || !this.transportConnected || this.state.historyOffline
      || !thread || this.loadedThreadId !== thread.id) return;
    const receipt = this.state.sidebar.readState[thread.id];
    if (!receipt?.unread) return;
    const seen = thread.turns?.some((turn) => turn.id === receipt.turnId && turn.status !== 'inProgress')
      || (receipt.turnId.startsWith('refresh:') && thread.updatedAt >= Number(receipt.turnId.slice(8)));
    const key = JSON.stringify([thread.id, receipt.turnId]);
    if (!seen || this.reading.has(key)) return;
    this.reading.add(key);
    const generation = this.synchronization;
    void this.connection.request<SidebarSnapshot>('request', {
      operation: 'threadRead', threadId: thread.id, turnId: receipt.turnId,
    }).then((sidebar) => {
      if (generation === this.synchronization) this.applySidebar(sidebar);
    }).catch(() => { /* Reconnection or the next history refresh retries this read receipt. */ })
      .finally(() => { this.reading.delete(key); });
  }

  async setSettings(settings: Partial<ComposerSettings>) { this.composer.set(settings); }

  /** Search without replacing the sidebar list or its pagination. */
  searchThreads = (options: { search: string; archived: boolean; cursor?: string }) =>
    this.request<ListResponse<Thread>>({ operation: 'list', ...options });

  async list(options: { search?: string; archived?: boolean; more?: boolean } = {}) {
    const generation = ++this.listGeneration;
    const search = options.search ?? this.state.search;
    const archived = options.archived ?? this.state.archived;
    const cursor = options.more ? this.state.cursor ?? undefined : undefined;
    this.update({ search, archived, loading: true });
    if (this.offline && !this.state.ready && this.synchronizing !== this.synchronization) {
      await this.listOffline();
      if (generation === this.listGeneration) this.update({ loading: false });
      return;
    }
    try {
      const result = await this.request<ListResponse<Thread> & { sidebar?: SidebarSnapshot }>({
        operation: 'list', search, archived, cursor,
      });
      if (generation !== this.listGeneration) return;
      this.applySidebar(result.sidebar);
      void this.offline?.updateSummaries?.(result.data, archived).catch(this.cacheFailure);
      const threads = options.more ? [...this.state.threads, ...result.data] : result.data;
      this.update({ threads: [...new Map(threads.map((thread) => [thread.id, thread])).values()],
        cursor: result.nextCursor });
    } catch (error) { if (generation === this.listGeneration) this.failure(error); }
    finally { if (generation === this.listGeneration) this.update({ loading: false }); }
  }

  async select(thread: Thread) {
    this.rememberHistory();
    void this.flushCache();
    this.readGeneration += 1;
    this.refreshThreadId = null;
    this.olderQueued = false;
    this.loadedThreadId = null;
    const cached = this.histories.get(thread.id);
    if (cached) this.historyPages.set(thread.id, cached.page);
    else this.historyPages.delete(thread.id);
    this.update({ selected: cached?.thread ?? thread, draftProject: null,
      selectedArchived: this.state.archived, error: '', historyOffline: Boolean(this.offline),
      historyHasMore: this.historyPages.get(thread.id)?.hasMore ?? false });
    if (this.offline && !this.state.ready) await this.readOffline(false);
    if (this.state.selected?.id !== thread.id || (this.offline && !this.transportConnected)) return;
    await Promise.all([this.refreshSelected(), this.composer.select()]);
  }

  async loadOlder() {
    // A manual pull retries even after the PC previously reported the beginning of history.
    if (!this.state.selected) return;
    if (this.offline && !this.state.ready) { await this.readOffline(true); return; }
    if (!this.state.ready) return;
    if (this.refreshThreadId === this.state.selected?.id) {
      if (!this.state.historyLoadingMore) {
        this.olderQueued = true;
        this.update({ historyLoadingMore: true });
      }
      return;
    }
    await this.refreshSelected(true);
  }

  async refreshSelected(older = false) {
    if (this.offline && !this.transportConnected) return;
    const selected = this.state.selected;
    if (!selected || this.refreshThreadId === selected.id) return;
    this.refreshThreadId = selected.id;
    this.historyDirty = false;
    const generation = ++this.readGeneration;
    this.update({ historyLoading: true, historyLoadingMore: older });
    try {
      const result = await this.historyReader.read(selected,
        { start: this.historyPages.get(selected.id)?.start, older });
      if (generation === this.readGeneration && this.state.selected?.id === selected.id) {
        this.loadedThreadId = selected.id;
        if (result.page) this.historyPages.set(selected.id, result.page);
        this.update({ selected: mergeHistory(result.thread, this.state.selected, selected, this.state.historyOffline),
          error: '', historyOffline: false,
          historyHasMore: result.page.hasMore });
        this.rememberHistory();
        this.markViewed();
      }
    } catch (error) { if (generation === this.readGeneration) this.failure(error); }
    finally {
      if (generation === this.readGeneration) {
        this.refreshThreadId = null;
        const olderQueued = this.olderQueued;
        this.olderQueued = false;
        this.update({ historyLoading: false, historyLoadingMore: false });
        if (olderQueued) void this.loadOlder();
        else if (this.historyDirty) this.scheduleHistory();
      }
    }
  }

  private async readOffline(older: boolean) {
    const selected = this.state.selected;
    if (!this.offline || !selected || this.refreshThreadId === selected.id) return;
    const generation = ++this.readGeneration;
    this.refreshThreadId = selected.id;
    this.update({ historyLoading: true, historyLoadingMore: older });
    try {
      await this.flushCache();
      const result = await this.offline.read(selected.id,
        { start: older ? this.historyPages.get(selected.id)?.start : undefined, older });
      if (generation !== this.readGeneration || this.state.selected?.id !== selected.id) return;
      if (result) {
        this.historyPages.set(selected.id, result.page);
        this.update({ selected: result.thread, selectedArchived: result.archived,
          historyOffline: true, historyHasMore: result.page.hasMore });
      }
    } catch { this.cacheFailure(); }
    finally {
      if (generation === this.readGeneration) {
        this.refreshThreadId = null;
        this.update({ historyLoading: false, historyLoadingMore: false });
      }
    }
  }

  private rememberHistory() {
    const thread = this.state.selected;
    if (!thread) return;
    this.histories.remember(thread, this.historyPages.get(thread.id));
    for (const id of this.historyPages.keys()) {
      if (id !== thread.id && !this.histories.has(id)) this.historyPages.delete(id);
    }
  }

  back(project: ChatProject | null = null) {
    if (this.state.sending) return;
    const inherit = this.state.selected && this.state.ready && !this.state.settingsBusy
      ? { model: this.state.settings.model, effort: this.state.settings.effort, access: this.state.settings.access }
      : undefined;
    this.rememberHistory();
    this.olderQueued = false;
    this.readGeneration += 1;
    this.refreshThreadId = null;
    this.loadedThreadId = null;
    this.update({ selected: null, draftProject: project ? { cwd: project.cwd, label: project.label } : null,
      selectedArchived: false, error: '', historyHasMore: false, historyLoading: false, historyLoadingMore: false });
    void this.flushCache();
    if (!this.offline || this.transportConnected) void this.composer.select(inherit);
    void this.list();
  }

  async send(input: SendInput) {
    if (this.state.desktopOnly) { this.update({ error: '请先登录电脑并打开聊天，再发送消息。' }); return false; }
    if (this.state.threadActionBusy) return false;
    if (input.goalMode) return this.goals.start(input);
    const images = input.images ?? [];
    if (this.state.selectedArchived) { this.update({ error: '请先恢复聊天，再发送消息。' }); return false; }
    if (this.state.sending || this.state.settingsBusy || (this.state.compacting
      && this.state.compacting === this.state.selected?.id)
      || (!input.text.trim() && !images.length && !input.skills?.length && !input.attachments?.length)) return false;
    try { validateChatImages(images); }
    catch (error) { this.failure(error); return false; }
    if (!this.state.ready) { this.update({ error: '正在连接电脑，请稍候再发送。' }); return false; }
    const generation = this.synchronization;
    const selection = { ...this.state.settings, model: input.model ?? this.state.settings.model,
      effort: input.effort ?? this.state.settings.effort, access: input.access };
    const message = { ...input, ...(selection.model ? { model: selection.model } : {}),
      ...(selection.effort ? { effort: selection.effort } : {}) };
    this.update({ sending: true, error: '',
      upload: hasUpload(input) ? { phase: 'preparing', percent: 0 } : undefined });
    try {
      let thread = this.state.selected;
      const created = !thread;
      if (!thread) {
        const result = await this.request<{ thread: Thread }>({ operation: 'start', model: selection.model || undefined,
          access: input.access, cwd: this.state.draftProject?.cwd });
        thread = result.thread;
        this.update({ selected: thread, draftProject: null, selectedArchived: false,
          threads: [thread, ...this.state.threads.filter((entry) => entry.id !== result.thread.id)],
          archived: false, search: '', cursor: null });
        await this.composer.created(thread.id, selection);
      }
      this.ensureCurrent(generation);
      if (!created) {
        const queue = await this.queueConnection.enqueue(thread, { ...message, images });
        if (queue && generation === this.synchronization) this.applyQueue(queue);
      } else {
        await this.request({ operation: 'send', threadId: thread.id, ...message, images });
      }
      void this.refreshSelected();
      return true;
    } catch (error) { this.failure(error); return false; }
    finally { this.update({ sending: false, upload: undefined }); }
  }

  answerAsyncQuestion = (item: import('./types').Item, answers: string[]) => this.asyncAnswers.submit(item, answers);

  private ensureCurrent(generation: number) {
    if (generation !== this.synchronization || !this.state.ready) throw new Error('连接已中断，请连接后再发送。');
  }

  imagePreview = async (threadId: string, source: string, original = false) => {
    if (this.managedPreviews) return this.previewDownloads!.image(threadId, source, original);
    const key = JSON.stringify([threadId, await contentStringHash(source), original]);
    return offlineImage({ store: this.offline, online: this.state.ready, key,
      load: () => this.images.load(threadId, source, original), failed: this.cacheFailure });
  };

  previewDownloads?: import('../previewDownloads').PreviewAdapter;
  private previewDownloadSupported = true;
  get managedPreviews() { return Boolean(this.previewDownloads && this.previewDownloadSupported); }
  savePreviewImage = (url: string) => {
    if (!this.previewDownloads) return Promise.reject(new Error('请更新应用后保存图片。'));
    return this.previewDownloads.saveImage(url);
  };

  videos: import('../video').VideoClient = {
    open: (threadId, path) => this.connection.request('request', { operation: 'videoOpen', threadId, path }),
    read: (request) => this.connection.request('request', { operation: 'videoRead', ...request }),
    close: (threadId, id) => this.connection.request('request', { operation: 'videoClose', threadId, id }),
  };

  files: import('../fileDownload').FileClient = {
    open: (threadId, path) => this.connection.request('request', { operation: 'fileOpen', threadId, path }),
    read: (request) => this.connection.request('request', { operation: 'fileRead', ...request }),
    close: (threadId, id) => this.connection.request('request', { operation: 'fileClose', threadId, id }),
  };

  downloads: import('../downloads').DownloadClient = {
    open: (options) => options.preview
      ? this.connection.request('request', { operation: 'previewOpen', transferId: options.transferId,
        threadId: options.threadId, path: options.path, preview: options.preview })
      : this.connection.request('request', { operation: 'downloadOpen', ...options }),
    browse: (options) => this.connection.request('request', { operation: 'downloadBrowse', ...options }),
    read: (request) => this.files.read(request),
    close: (transferId, id) => this.files.close(transferId, id),
  };

  textPreview = (threadId: string, path: string) => this.managedPreviews
    ? this.previewDownloads!.text(threadId, path)
    : this.connection.request<import('../textPreview').TextPreview>('request', { operation: 'textPreview', threadId, path });

  loadSkills = async (cwd: string) => {
    const generation = this.skillGeneration;
    const result = await this.request<SkillsResponse>({ operation: 'skills', cwd: cwd || undefined });
    // Switching between relay and direct transport still returns the same computer's catalog.
    if (!this.active || generation !== this.skillGeneration) throw new Error('连接已中断，请重新打开技能菜单。');
    return result;
  };

  loadComposerCatalog = async (cwd: string) => {
    const generation = this.skillGeneration;
    const result = await this.connection.request<RemoteComposerCatalog>('request', {
      operation: 'skills', cwd: cwd || undefined, includePlugins: true,
    });
    if (!this.active || generation !== this.skillGeneration) throw new Error('请连接电脑后重新打开插件。');
    return result;
  };

  loadProjectFiles = (options: ProjectFilesRequest) =>
    this.connection.request<ProjectFilesResponse>('request', { operation: 'projectFiles', ...options });

  loadProjectDirectories = (directory: string) =>
    this.connection.request<import('../projectDirectories').ProjectDirectoriesResponse>('request', {
      operation: 'projectDirectories', directory,
    });

  chooseDraftProject = (project: ChatProject) => {
    if (!this.state.ready || this.state.selected || this.state.sending || !project.cwd.trim()) return;
    this.update({ draftProject: { cwd: project.cwd, label: project.label }, error: '' });
  };

  compact = async () => {
    const selected = this.state.selected;
    if (!selected || compactUnavailableReason(this.state)) return false;
    const threadId = selected.id;
    const generation = this.synchronization;
    this.update({ compacting: threadId, error: '' });
    try {
      await this.request({ operation: 'resume', threadId,
        access: this.state.settings.access });
      this.ensureCurrent(generation);
      const { thread } = await this.historyReader.read(selected, {});
      this.ensureCurrent(generation);
      if (this.state.selected?.id !== threadId || thread.turns?.some((turn) => turn.status === 'inProgress')
        || this.state.selected.turns?.some((turn) => turn.status === 'inProgress')
        || this.state.approvals.some((event) => event.params.threadId === threadId)) {
        this.update({ compacting: undefined });
        return false;
      }
      await this.request({ operation: 'compact', threadId });
      // The acknowledgement precedes completion; lifecycle events release the guard.
      return true;
    } catch (error) {
      if (generation === this.synchronization) {
        this.update({ compacting: undefined });
        this.failure(error);
      }
      return false;
    }
  };

  async interrupt() {
    const thread = this.state.selected;
    const turn = thread?.turns?.find((entry) => entry.status === 'inProgress');
    if (!thread || !turn) return;
    try {
      await this.goals.pause(thread.id);
      await this.request({ operation: 'interrupt', threadId: thread.id, turnId: turn.id });
    }
    catch (error) { this.failure(error); }
  }

  async respond(reply: ApprovalReply) {
    try {
      await this.connection.request('respond', reply);
      this.update({ approvals: this.state.approvals.filter((event) => event.id !== reply.id) });
    } catch (error) { this.failure(error); }
  }

  private completeThreadMutation(body: ThreadMutation) {
    const { threadId, operation } = body;
    this.listGeneration += 1;
    if (operation !== 'rename' && this.state.selected?.id === threadId) {
      this.readGeneration += 1; this.refreshThreadId = null; this.loadedThreadId = null;
      this.olderQueued = false;
      this.update({ selected: null, selectedArchived: false, historyLoading: false,
        historyLoadingMore: false, historyHasMore: false });
    }
    this.histories.remove(threadId);
    if (operation === 'delete') {
      this.historyPages.delete(threadId);
      this.offlineWriter?.forget(threadId);
    } else {
      const thread = this.state.threads.find(entry => entry.id === threadId);
      const archived = operation === 'rename' ? this.state.archived : operation === 'archive';
      if (thread) void this.flushCache().then(() => this.offline?.updateSummaries?.([
        operation === 'rename' ? { ...thread, name: body.name } : thread,
      ], archived)).catch(this.cacheFailure);
    }
    this.update(threadMutationPatch(this.state, body));
  }

  async archive() {
    const thread = this.state.selected;
    if (!thread) return;
    try {
      await this.threadActions.run(thread, this.state.selectedArchived ? 'unarchive' : 'archive');
    } catch (error) { this.failure(error); }
  }
}
