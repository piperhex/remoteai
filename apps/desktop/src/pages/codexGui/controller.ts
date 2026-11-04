import { guiApi } from "../../../../../shared/conversation/api";
import { CapacityRetry } from "../../../../../shared/conversation/capacityRetry";
import { ConversationCache } from "./conversationCache";
import { GuiThreadList } from "./threadList";
import type { ThreadListQuery } from "../../../../../shared/remote-chat/client/threadListCache";
import { ConversationHistory } from "./conversationHistory";
import { sendCapacityRetry } from "./sendCapacityRetry";
import { forkGuiConversation } from "./forkConversation";
import { GuiMessageEditor } from "../../../../../shared/conversation/editMessage";
import { GuiGoals } from "./goals";
import { GuiProjects } from "./projectActions";
import { selectGuiProject } from './projectSelection';
import { createGuiGroups } from './groupActions';
import { GuiReadState } from "./threadReadState";
import type { AttachmentReference } from "../../../../../shared/conversation/attachmentTypes";
import { deleteGuiThread } from "./deleteThread";
import { reduceEvent } from "../../../../../shared/conversation/events";
import { conversationSnapshot as conversation } from './conversationSnapshot';
import { withSentMessage } from '../../../../../shared/conversation/sentMessages';
import { acceptGuiTurn } from './acceptedTurn';
import { MessageQueue } from "./messageQueue";
import { isMessageQueueEnabled } from "../../../../../shared/chat/messageQueueSettings";
import { sendImmediateMessage } from "./sendImmediateMessage";
import { QueueJournal, type QueueStorage } from './queueJournal';
import { asyncAnswerText, pendingAsyncQuestions, withAsyncAnswer } from "../../../../../shared/conversation/asyncQuestionState";
import { compactUnavailableReason } from "./composerOptions";
import { rememberTurnDetails } from "../../../../../shared/conversation/turnDetailsStorage";
import { trackProcessingApproval } from "../../../../../shared/conversation/processingApprovals";
import { initialState, savePreferences } from "./preferences";
import { ThreadModelSettings } from "./threadModelSettings";
import { modelSelectionError } from "../../../../../shared/conversation/modelSelection";
import { GuiModelCatalog } from "./modelCatalog";
import { GuiThreadTitles } from "./threadTitles";
import type { ApprovalReply, GuiEvent, GuiState, Model, Settings, Thread, Turn } from "../../../../../shared/conversation/types";
import type { Item, MessageInput, SkillReference } from "../../../../../shared/conversation/types";
import { isTextDelta, StreamFrame } from '../../../../../shared/chat/streamFrame';

export class GuiController {
  readonly groups = createGuiGroups({ snapshot: () => this.state, patch: patch => this.patch(patch) });
  readonly queueJournal: QueueJournal;
  constructor(storage?: QueueStorage, cacheBytes?: number) {
    this.conversationCache = new ConversationCache(cacheBytes);
    this.queueJournal = new QueueJournal(storage, queued => this.patch({ queued }), this.report);
  }
  private state = initialState();
  private listeners = new Set<() => void>();
  private messageListeners = new Set<() => void>();
  private readonly conversationCache: ConversationCache;
  private readonly lists = new GuiThreadList({ getSnapshot: () => this.state,
    patch: patch => this.patch(patch), observe: threads => this.readState.observeThreads(threads),
    report: error => this.report(error) });
  private readonly threadList = this.lists.cache;
  private selectionGeneration = 0;
  private deletedThreads = new Set<string>();
  private unlisten?: () => void;
  private disposed = false;
  private connecting?: Promise<void>;
  private reportedModelError?: string;
  readonly modelCatalog = new GuiModelCatalog({ ready: () => this.state.connection === "ready",
    accept: (models) => this.setModels(models),
    failed: (modelCatalogError) => this.patch({ modelCatalogError }),
    recovered: () => {
      if (this.state.error === this.reportedModelError) this.clearError();
      this.reportedModelError = undefined;
    },
    syncing: (modelCatalogLoading) => {
      this.patch({ modelCatalogLoading });
      if (!modelCatalogLoading) Object.keys(this.state.queued).forEach(id => void this.queue.flush(id));
    } });
  private readonly stream = new StreamFrame(events => {
    this.patch(events.reduce(reduceEvent, this.state), true, true);
  });
  readonly titles = new GuiThreadTitles({ active: () => !this.disposed, receive: (event) => this.receive(event),
    currentName: (id) => this.state.conversations[id]?.thread.name
      ?? this.state.threads.find((thread) => thread.id === id)?.name });
  getSnapshot = () => this.state;
  readThreadList = (query: ThreadListQuery, options: { pageSize: number; force?: boolean }) =>
    this.lists.readRemote(query, options);
  receiveThreadListEvent = (event: GuiEvent) => this.lists.receiveRemote(event);
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  /** Text deltas cannot introduce acknowledged user messages. */
  subscribeMessageUpdates = (listener: () => void) => {
    this.messageListeners.add(listener); return () => this.messageListeners.delete(listener);
  };
  retainConversation = (id: string) => {
    const release = this.conversationCache.retain(id);
    return () => { release(); this.trimConversations(); };
  };
  private trimConversations() {
    const conversations = this.conversationCache.trim(this.state, this.capacityRetry.retainedThreads());
    if (conversations !== this.state.conversations) this.patch({ conversations });
  }
  private patch = (patch: Partial<GuiState>, notify = true, streaming = false) => {
    if (this.disposed) return;
    const previous = this.state;
    this.state = { ...this.state, ...patch };
    if (previous.search === this.state.search && previous.archived === this.state.archived) {
      this.threadList.observe(previous.threads, this.state.threads, this.state.archived);
    }
    if (!streaming) this.state.conversations = this.conversationCache.trim(this.state, this.capacityRetry.retainedThreads());
    if (previous.queued !== this.state.queued) this.queueJournal.remember(this.state.queued);
    this.capacityRetry.sync(previous, this.state);
    if (previous.selected !== this.state.selected) savePreferences(this.state);
    if (!streaming && previous.conversations !== this.state.conversations) {
      this.messageListeners.forEach(listener => listener());
    }
    if (notify) this.listeners.forEach((listener) => listener());
  };
  report = (error: unknown) => {
    this.flushStream();
    const message = error instanceof Error ? error.message : error;
    this.patch({ error: typeof message === "string" ? message : "操作未完成，请重试。" });
  };
  clearError = () => this.patch({ error: "" });
  readonly capacityRetry = new CapacityRetry({ getSnapshot: this.getSnapshot, patch: this.patch,
    send: (threadId, canSend) => sendCapacityRetry({ getSnapshot: this.getSnapshot, patch: this.patch,
      selection: (id) => this.modelSettings.ready(id), catalogGuard: () => this.modelCatalog.guard(),
      acceptTurn: (id, turn) => this.acceptTurn(id, turn), report: this.report, refresh: () => this.refresh(false, false),
      flushQueue: () => Object.keys(this.state.queued).forEach(id => void this.queue.flush(id)),
    }, threadId, canSend) });
  setWorkspaceBusy = (workspaceBusy: boolean) => {
    this.patch({ workspaceBusy });
    if (!workspaceBusy) Object.keys(this.state.queued).forEach((id) => void this.queue.flush(id));
  };
  readonly messageEditor = new GuiMessageEditor({ getSnapshot: this.getSnapshot, patch: this.patch, report: this.report,
    acceptTurn: (threadId, turn) => this.acceptTurn(threadId, turn), refresh: () => this.refresh(false, false),
    flushQueue: () => Object.keys(this.state.queued).forEach((id) => void this.queue.flush(id)) });
  readonly goals = new GuiGoals({ getSnapshot: this.getSnapshot, patch: this.patch, report: this.report });
  readonly projectActions = new GuiProjects({ getSnapshot: this.getSnapshot, patch: this.patch, report: this.report });
  readonly readState = new GuiReadState({ getSnapshot: this.getSnapshot, patch: this.patch });
  private history = new ConversationHistory({ getSnapshot: this.getSnapshot, patch: this.patch,
    markRead: id => this.readState.markRead(id), loaded: id => {
      void this.goals.load(id);
      if (!this.state.archived) void this.queue.flush(id);
    } });
  readonly queue = new MessageQueue({ getSnapshot: this.getSnapshot, patch: this.patch,
    catalogGuard: () => this.modelCatalog.guard(), selection: (id) => this.modelSettings.selection(id),
    saved: () => this.queueJournal.saved(),
    active: () => !this.disposed, report: this.report,
    generateTitle: (thread, prompt) => this.titles.generate(thread, prompt),
    acceptTurn: (threadId, turn) => this.acceptTurn(threadId, turn) });
  readonly modelSettings = new ThreadModelSettings({ getSnapshot: this.getSnapshot, patch: this.patch,
    updateQueue: (threadId, selection) => this.queue.updateSettings(threadId, selection), report: this.report });

  private acceptTurn(threadId: string, turn: Turn) {
    const release = this.retainConversation(threadId);
    try { acceptGuiTurn({ getSnapshot: this.getSnapshot, patch: this.patch,
      readState: this.readState, capacityRetry: this.capacityRetry }, threadId, turn); }
    finally { release(); }
  }

  /** Keep confirmed local and remote sends visible even if interruption precedes the user item. */
  acceptSentTurn = (threadId: string, turn: Turn, input: MessageInput) => {
    this.acceptTurn(threadId, withSentMessage(turn, [{ ...input, id: turn.id }], 0));
  };

  private flushStream = () => {
    this.stream.flush();
  };
  private receive = (event: GuiEvent) => {
    if (this.disposed) return;
    if (!isTextDelta(event)) this.flushStream();
    const threadId = event.params.threadId ?? event.params.thread?.id;
    const known = threadId ? this.state.conversations[threadId]?.thread : undefined;
    if (known && !this.threadList.has(known.id)) this.threadList.upsert(known);
    const missingSummary = this.threadList.receive(event);
    if (["connection/closed", "connection/restored"].includes(event.method)) this.threadList.invalidate();
    if (missingSummary) void this.refresh(false, false);
    this.history.receive(event);
    if (event.method === "thread/deleted" && threadId) {
      this.forgetThread(threadId);
      void this.refresh(false, false);
      return;
    }
    if (threadId && this.deletedThreads.has(threadId)) return;
    if (event.method === "connection/restored") { void this.connect(); return; }
    if (event.method === "connection/updated") { void this.connect({ reuseExisting: true }); return; }
    if (isTextDelta(event)) {
      this.stream.push(event);
      return;
    }
    const release = threadId ? this.conversationCache.retain(threadId) : undefined;
    try { this.receiveSettled(event); }
    finally { release?.(); this.trimConversations(); }
  };

  private receiveSettled(event: GuiEvent) {
    this.patch(reduceEvent(this.state, event));
    const listed = this.threadList.peek(this.state);
    if (listed) this.patch({ threads: listed.data });
    this.capacityRetry.receive(event);
    this.readState.receive(event);
    if (["turn/diff/updated", "turn/plan/updated"].includes(event.method) && event.params.threadId) {
      const value = this.state.conversations[event.params.threadId];
      const turnId = event.params.turnId ?? value?.activeTurn;
      if (value && turnId) rememberTurnDetails(value, turnId);
    }
    if (event.method === "turn/completed" && event.params.threadId) void this.queue.flush(event.params.threadId);
  }

  connect = (options?: { reuseExisting: boolean }) => {
    if (this.connecting) return this.connecting;
    this.connecting = this.initialize(options).finally(() => { this.connecting = undefined; });
    return this.connecting;
  };

  refreshModels = () => {
    if (this.state.modelCatalogError) this.clearError();
    if (this.state.connection !== "ready") return this.connect();
    return this.modelCatalog.refresh().catch(error => {
      const message: unknown = error instanceof Error ? error.message : error;
      this.reportedModelError = typeof message === "string" ? message : "操作未完成，请重试。";
      throw error;
    });
  };

  private async initialize(options?: { reuseExisting: boolean }) {
    this.modelCatalog.suspend();
    this.patch({ connection: "connecting", error: "" });
    try {
      await this.queueJournal.restore();
      if (!this.unlisten) {
        const stop = await guiApi.subscribe(this.receive);
        if (this.disposed) { stop(); return; }
        this.unlisten = stop;
      }
      const approvals = await (options ? guiApi.connect(options) : guiApi.connect());
      this.patch({ connection: "ready", approvals, error: "" });
      this.modelCatalog.activate();
      const results = await Promise.allSettled([
        this.refresh(false, false), this.modelCatalog.restore().catch(() => {
          // A missing local catalog waits for an explicit retry or source change.
        }), this.modelSettings.refresh(),
      ]);
      results.forEach((result) => { if (result.status === "rejected") this.report(result.reason); });
      if (this.state.selected) await this.select(this.state.selected);
      this.patch(this.state.approvals.reduce(trackProcessingApproval, this.state));
      Object.keys(this.state.queued).forEach((id) => void this.queue.flush(id));
    } catch (error) {
      this.patch({ connection: "offline", modelCatalogError: "模型列表暂时无法更新，请稍后重试。" });
      this.report(error);
    }
  }

  setModels = async (models: Model[]) => {
    if (this.disposed) return;
    this.patch({ models });
    this.modelSettings.catalogChanged();
  };

  refresh = (more = false, force = !more) => this.lists.refresh(more, force);
  filter = (search: string, archived: boolean) => this.lists.filter(search, archived);
  settings = (settings: Partial<Settings>) => {
    const modelChanged = settings.model !== undefined || settings.effort !== undefined;
    // Publish combined permission/model changes only after the model choice has been resolved.
    this.patch({ settings: { ...this.state.settings, ...settings } }, !modelChanged);
    if (modelChanged) this.modelSettings.change({
      ...(settings.model !== undefined ? { model: settings.model } : {}),
      ...(settings.effort !== undefined ? { effort: settings.effort } : {}),
    });
    if (this.state.selected && (settings.model !== undefined || settings.effort !== undefined
      || settings.access !== undefined)) {
      const { model, effort, access } = this.state.settings;
      this.queue.updateSettings(this.state.selected, { model, effort, access });
    }
    if (settings.cwd) this.patch({ projects: [...new Set([settings.cwd, ...this.state.projects])].slice(0, 20) });
    savePreferences(this.state);
  };
  setProject = (cwd: string) => {
    const id = this.state.selected;
    if (this.state.sending || (id && this.state.conversations[id]?.activeTurn)) return;
    if (id) this.patch({ projectOverrides: { ...this.state.projectOverrides, [id]: cwd } });
    this.settings({ cwd });
  };
  moveThreadToProject = async (threadId: string, cwd: string) => {
    await selectGuiProject(this, { cwd, threadId, removeFromGroup: true });
  };
  pin = (id: string) => {
    const pins = this.state.pins.includes(id) ? this.state.pins.filter((pin) => pin !== id) : [...this.state.pins, id];
    this.patch({ pins });
    savePreferences(this.state);
  };
  newConversation = () => {
    this.flushStream();
    ++this.selectionGeneration;
    if (this.state.selected && !this.state.modelSettingsLoading) {
      const { model, effort } = this.state.settings;
      this.modelSettings.change({ model, effort }, null);
    }
    this.patch({ selected: null, error: "", archived: false });
    void this.modelSettings.select(null);
    if (this.state.connection === "ready") void this.refresh(false, false);
  };

  select = async (id: string) => {
    this.flushStream();
    if (this.state.deleting === id) return;
    this.deletedThreads.delete(id);
    this.conversationCache.touch(id);
    const generation = ++this.selectionGeneration;
    this.patch({ selected: id, error: "" });
    await this.modelSettings.select(id);
    if (generation !== this.selectionGeneration) return;
    try { await this.history.select(id, () => generation === this.selectionGeneration); }
    catch (error) { if (generation === this.selectionGeneration) this.report(error); }
  };

  forkConversation = (threadId: string, turnId?: string): Promise<boolean> => forkGuiConversation({
    getSnapshot: this.getSnapshot, patch: this.patch, report: this.report, modelSettings: this.modelSettings,
    selectionGeneration: () => this.selectionGeneration, select: this.select, refresh: () => this.refresh(false, false),
  }, threadId, turnId);

  /** Load the phone's conversation without changing the conversation selected on the PC. */
  loadRemoteThread = (threadId: string): Promise<void> => {
    this.conversationCache.touch(threadId);
    return this.history.loadRemote(threadId);
  };

  private acceptSentThread(thread: Thread, context: {
    selected: string | null; startedAtMs: number; projectOverride?: string; settings: Settings;
  }) {
    this.threadList.upsert(thread, false);
    const { selected, startedAtMs, projectOverride } = context;
    if (!selected) {
      const { model, effort } = context.settings;
      this.modelSettings.created(thread.id, { model, effort });
    }
    const stillSelected = this.state.selected === selected;
    this.patch({ selected: stillSelected ? thread.id : this.state.selected,
      pendingRequest: { threadId: thread.id, startedAtMs },
      conversations: { ...this.state.conversations,
        [thread.id]: conversation(thread, this.state.conversations[thread.id]) } });
    if (!stillSelected) return;
    this.settings({ cwd: projectOverride ?? thread.cwd });
    this.modelSettings.catalogChanged();
  }

  send = async (text: string, images: string[], skills: SkillReference[] = [], attachments: AttachmentReference[] = []) => {
    const { selected, settings, conversations } = this.state;
    const projectOverride = selected ? this.state.projectOverrides[selected] : undefined;
    if (this.state.modelCatalogLoading || this.state.modelSettingsLoading
      || modelSelectionError(this.state.models, settings)
      || this.state.workspaceBusy || this.state.sending
      || this.state.deleting || this.state.compacting === selected
      || this.state.connection !== "ready" || this.state.archived
      || (!text.trim() && !images.length && !skills.length && !attachments.length)) return false;
    const queueEnabled = isMessageQueueEnabled();
    if (!queueEnabled && selected && conversations[selected]?.activeTurn) {
      return sendImmediateMessage({ getSnapshot: this.getSnapshot, patch: this.patch, report: this.report,
        flushQueue: () => Object.keys(this.state.queued).forEach(id => void this.queue.flush(id)),
      }, selected, { text, images, skills, ...(attachments.length ? { attachments } : {}) });
    }
    if (queueEnabled && selected && (conversations[selected]?.activeTurn || this.state.queued[selected]?.length)) {
      const accepted = this.queue.enqueue(selected, { text, images, skills, ...(attachments.length ? { attachments } : {}) });
      if (accepted) {
        try { await this.queueJournal.saved(); }
        catch (error) { this.queue.hold(selected); this.report(error); return false; }
        void this.queue.flush(selected);
      }
      return accepted;
    }
    const startedAtMs = Date.now();
    const currentCatalog = this.modelCatalog.guard();
    this.patch({ sending: true, pendingRequest: { threadId: selected, startedAtMs }, error: "" });
    try {
      const response = selected
        ? await guiApi.request<{ thread: Thread }>({ operation: "resume", threadId: selected,
          access: settings.access, cwd: projectOverride })
        : await guiApi.request<{ thread: Thread }>({ operation: "start", cwd: settings.cwd || undefined,
          model: settings.model || undefined, access: settings.access });
      const { thread } = response;
      if (!currentCatalog()) return false;
      this.acceptSentThread(thread, { selected, startedAtMs, projectOverride, settings });
      // Loaded threads can ignore resume overrides; apply project and access settings to each new turn.
      const { turn } = await guiApi.request<{ turn: Turn }>({ operation: "send", threadId: thread.id,
        text, images, skills, ...(attachments.length ? { attachments } : {}), model: settings.model || undefined,
        effort: settings.effort || undefined, cwd: projectOverride, access: settings.access });
      // Completion can arrive before the request promise resolves. Never resurrect a completed turn.
      this.acceptSentTurn(thread.id, turn, { text, images, skills, attachments });
      void this.titles.generate(thread, text);
      void this.refresh(false, false);
      return true;
    } catch (error) { this.report(error); return false; }
    finally {
      this.patch({ sending: false, pendingRequest: undefined });
      Object.keys(this.state.queued).forEach((id) => void this.queue.flush(id));
    }
  };

  answerAsyncQuestion = async (item: Item, answers: string[]): Promise<boolean> => {
    const state = this.state;
    const threadId = state.selected;
    const current = threadId ? state.conversations[threadId] : undefined;
    const text = asyncAnswerText(item, answers);
    if (!threadId || !current || !text || state.connection !== "ready" || state.archived
      || state.sending || state.workspaceBusy || state.deleting || state.compacting === threadId
      || !pendingAsyncQuestions(current).some((question) => question.id === item.id)) return false;
    if (!current.activeTurn) return this.send(text, []);
    const turnId = current.activeTurn;
    const userMessageIndex = current.turns.find((turn) => turn.id === turnId)
      ?.items.filter((entry) => entry.type === "userMessage").length ?? 0;
    this.patch({ sending: true, error: "" });
    try {
      await guiApi.request({ operation: "steer", threadId, turnId, text, images: [], skills: [] });
      const latest = this.state.conversations[threadId];
      if (latest) this.patch({ conversations: { ...this.state.conversations, [threadId]: { ...latest,
        turns: latest.turns.map((turn) => turn.id === turnId
          ? withAsyncAnswer(turn, text, userMessageIndex) : turn) } } });
      return true;
    } catch (error) { this.report(error); return false; }
    finally {
      this.patch({ sending: false });
      Object.keys(this.state.queued).forEach((id) => void this.queue.flush(id));
    }
  };

  compact = async () => {
    const id = this.state.selected;
    if (!id || compactUnavailableReason(this.state)) return false;
    this.patch({ compacting: id, error: "" });
    try {
      // Reading history does not load the thread into the app-server's active session.
      const { thread } = await guiApi.request<{ thread: Thread }>({ operation: "resume", threadId: id,
        access: this.state.settings.access });
      const current = conversation(thread, this.state.conversations[id]);
      if (current.activeTurn || this.state.conversations[id]?.activeTurn) {
        this.patch({ compacting: undefined });
        return false;
      }
      this.patch({ conversations: { ...this.state.conversations, [id]: current } });
      await guiApi.request({ operation: "compact", threadId: id });
      // The acknowledgement precedes completion; lifecycle events release the guard.
      return true;
    } catch (error) {
      this.patch({ compacting: undefined });
      this.report(error);
      return false;
    }
  };

  interrupt = async () => {
    this.flushStream();
    this.capacityRetry.stop();
    const id = this.state.selected;
    const turnId = id ? this.state.conversations[id]?.activeTurn : null;
    if (!id || !turnId) return;
    if (this.state.goals?.[id]?.status === "active"
      && !await this.goals.set({ threadId: id, status: "paused" })) return;
    try { await guiApi.request({ operation: "interrupt", threadId: id, turnId }); }
    catch (error) { this.report(error); }
  };

  manage = async (operation: "rename" | "archive" | "unarchive", id: string, name?: string) => {
    if (this.state.conversations[id]?.activeTurn || this.state.deleting === id || this.state.compacting === id) return;
    if (operation === "archive" && this.state.queued[id]?.length) {
      this.report("请先发送或删除待发送消息，再归档对话。");
      return;
    }
    if (operation === "archive") this.capacityRetry.stop(id);
    try {
      await guiApi.request(operation === "rename"
        ? { operation, threadId: id, name: name ?? "" } : { operation, threadId: id });
      this.threadList.receive({ method: operation === "rename" ? "thread/name/updated"
        : operation === "archive" ? "thread/archived" : "thread/unarchived",
      params: { threadId: id, threadName: name } });
      if (operation === "rename" && this.state.conversations[id]) {
        const value = this.state.conversations[id];
        this.patch({ conversations: { ...this.state.conversations,
          [id]: { ...value, thread: { ...value.thread, name } } } });
      }
      if (operation === "archive" && this.state.selected === id) this.newConversation();
      if (operation === "unarchive") { this.patch({ archived: false }); await this.select(id); }
      await this.refresh(false, false);
    } catch (error) { this.report(error); }
  };

  deleteThread = async (id: string) => {
    if (this.state.deleting || this.state.sending || this.state.compacting === id || this.state.connection !== "ready"
      || this.state.conversations[id]?.activeTurn || this.state.queued[id]?.length
      || this.state.threads.some((thread) => thread.id === id && thread.status?.type === "active")
      || this.state.approvals.some((event) => event.params.threadId === id)) {
      this.report("请等待回复结束，并处理待发送消息后再删除对话。");
      return false;
    }
    if (this.state.selected === id) ++this.selectionGeneration;
    this.patch({ deleting: id, error: "" });
    try {
      const report = await deleteGuiThread(id);
      for (const deleted of report.deletedThreadIds ?? [id]) this.forgetThread(deleted);
      await this.refresh(false, false);
      return true;
    } catch (error) { this.report(error); return false; }
    finally { this.patch({ deleting: undefined }); }
  };

  private forgetThread(id: string) {
    this.threadList.remove(id);
    if (this.state.selected === id) ++this.selectionGeneration;
    this.flushStream();
    this.deletedThreads.add(id);
    this.lists.reset();
    const conversations = { ...this.state.conversations };
    const queued = { ...this.state.queued };
    const projectOverrides = { ...this.state.projectOverrides };
    const threadReadState = { ...this.state.threadReadState };
    delete threadReadState[id];
    delete conversations[id]; delete queued[id]; delete projectOverrides[id];
    this.patch({ conversations, queued, projectOverrides, threadReadState,
      threads: this.state.threads.filter((thread) => thread.id !== id),
      pins: this.state.pins.filter((pin) => pin !== id),
      approvals: this.state.approvals.filter((event) => event.params.threadId !== id),
      selected: this.state.selected === id ? null : this.state.selected });
    savePreferences(this.state);
  }

  respond = async (reply: ApprovalReply) => {
    try {
      await guiApi.respond(reply);
      this.patch(reduceEvent(this.state, { method: "serverRequest/resolved", params: { requestId: reply.id } }));
    } catch (error) { this.report(error); }
  };

  activate = () => { this.disposed = false; this.modelCatalog.activate(); };
  suspend = () => {
    this.threadList.invalidate();
    this.modelCatalog.suspend();
    this.unlisten?.(); this.unlisten = undefined;
    this.flushStream();
    this.patch({ ...reduceEvent(this.state, { method: "connection/closed", params: {} }), error: "" });
  };
  dispose = () => {
    this.flushStream();
    this.threadList.invalidate();
    this.modelCatalog.suspend();
    this.capacityRetry.cancelAll();
    this.disposed = true; this.unlisten?.(); this.unlisten = undefined;
    this.listeners.clear(); this.messageListeners.clear();
  };
}
