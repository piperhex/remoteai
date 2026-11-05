import { fileDownloadByteLimit, imagePreviewByteLimit, textPreviewByteLimit, videoByteLimit }
  from '../../../../shared/remote-chat/policy';
import { remoteAttachments } from '../../../../shared/remote-chat/composerAttachments';
import { guiApi } from '../../../../shared/conversation/api';
import { summarizeTools } from '../../../../shared/conversation/toolDetails';
import type { ApprovalReply, GuiEvent, ListResponse, Request, SkillsResponse, Thread } from '../../../../shared/conversation/types';
import { object, type ConnectionMode, type RpcRequest, type RpcResponse }
  from '../../../../shared/remote-chat/protocol';
import { chunks } from '../../../../shared/remote-chat/framing';
import { guiComposer } from '../pages/codexGui/composerBridge';
import { composerThreadId } from '../../../../shared/remote-chat/composer';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';
import { GROUPS_OPERATION } from '../../../../shared/chat/groups/model';
import { remoteGroups } from './groups';
import { historyDelta, parseHistoryVersion } from '../../../../shared/remote-chat/historySync';
import { RemoteImages } from './images';
import { parseHistoryWindow, sliceHistory, type HistoryPage } from '../../../../shared/remote-chat/historyPage';
import { getChatPolicy } from '../../../../shared/remote-chat/policy';
import { historyNotification } from '../../../../shared/remote-chat/historyNotification';
import { LiveHistory } from './liveHistory';
import { ConversationViews } from './conversationViews';
import { CommandMetricsStore } from './commandMetrics';
import { composerCatalog } from './composerCatalog';
import { remoteQueue } from './queue';
import { readGuiAccounts, selectGuiAccount } from './guiAccounts';
import { acknowledgedMessages } from './acknowledgedMessages';
import { chatHandshake, validateChatHandshake } from '../../../../shared/remote-chat/handshake';
import { guiConnectionError } from '../../../../shared/remote-chat/connectionErrors';
import { invoke } from '../api/backend';
import type { UsageSummary } from '../../../../shared/remote-chat/usage';
import { CONVERSATION_METRICS_OPERATION, type ConversationMetrics }
  from '../../../../shared/remote-chat/conversationMetrics';
import { TOKEN_SUMMARY_OPERATION } from '../../../../shared/remote-chat/tokenSummary';
import { encodeTokenSummary, QUOTA_HISTORY_FORMAT } from '../../../../shared/remote-chat/tokenSummaryCodec';
import { readTokenSummary } from './tokenSummary';
import { CONTEXT_READ_OPERATION, CONTEXT_WRITE_OPERATION } from '../../../../shared/remote-chat/contextSettings';
import { contextSettingsRequest } from './contextSettings';
import { GUI_TOOL_OPERATIONS } from '../../../../shared/remote-chat/guiTools';
import { CODEX_STATUS_OPERATION } from '../../../../shared/codex-status/status';
import { GUI_FILE_OPERATIONS } from '../../../../shared/remote-chat/files';
import { RemoteFiles } from './files';
import { guiToolRequest } from './guiTools';
import { remoteTerminals, type RemoteTerminals } from './terminals';
import { deleteRemoteThread, pinRemoteThread } from './threadActions';
import { forkRemoteConversation } from './forkConversation';
import { changeRemoteMessage } from './messageEdit';
import { sendRemoteMessage } from './sendMessage';
import { RemoteDesktopHost } from '../remoteDesktop/host';
import { DESKTOP_OPERATION } from '../../../../shared/remote-desktop/protocol';
import { RemoteThreadTitles } from './threadTitles';
import { applyProjectOverride, effectiveProjectThread } from './projects';
import { PROJECT_LIST_OPERATION, PROJECT_PIN_OPERATION, PROJECT_REMOVE_OPERATION }
  from '../../../../shared/remote-chat/projects';
import { changeRemoteProject } from './projectActions';
import { readRemoteThreadList, completeRemoteThreadListWrite, receiveRemoteThreadListEvent } from './threadList';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { RemoteDictation } from './dictation';
import { DICTATION_OPERATION } from '../../../../shared/remote-chat/dictation';

const OPERATIONS = new Set([
  'toolDetails',
  'projectFileRead', 'projectFileBlame', 'projectFileWrite', 'projectEntryAction',
  'suggestNextPrompt',
  'guiGitGenerateMessage',
  'downloadOpen', 'downloadBrowse', 'previewOpen',
  'fileOpen', 'fileRead', 'fileClose',
  'videoOpen', 'videoRead', 'videoClose',
  'projectDirectories',
  'models', 'list', 'read', 'start', 'resume', 'send', 'steer', 'interrupt', 'rename', 'archive', 'unarchive',
  'compact', 'skills', 'cozeCatalog', 'projectFiles', 'imagePreview', 'textPreview', 'goalGet', 'goalSet', 'goalClear',
]);
const CACHE_TTL_MS = 5 * 60_000;
interface Cached {
  fingerprint: string; result: Promise<RpcResponse>; expires: number; completed: boolean; readOnly: boolean;
  terminalLink?: { terminal: unknown; stream: unknown; action: unknown };
}
function terminalLinkRequest(request: RpcRequest): Cached['terminalLink'] {
  const body = request.body as { operation?: unknown; id?: unknown; request?: unknown;
    action?: unknown; resource?: unknown } | undefined;
  if (request.method === 'request' && body?.operation === 'guiResourceStream') {
    return { terminal: JSON.stringify([body.operation, body.resource]), stream: body.id,
      action: body.action === 'open' ? 'connect' : 'close' };
  }
  if (request.method !== 'request' || !body || !['guiTerminalLink', 'guiResourceLink'].includes(String(body.operation))
    || !body.request || typeof body.request !== 'object' || Array.isArray(body.request)) return;
  const stream = object(body.request);
  const udpActions: Record<string, string> = { udpConnect: 'connect', udpRead: 'read',
    udpWrite: 'write', udpClose: 'close' };
  return { terminal: JSON.stringify([body.operation, body.id]), stream: stream.id,
    action: udpActions[String(stream.type)] ?? stream.type };
}
const READ_OPERATIONS = new Set([
  'toolDetails',
  'viewThread',
  CODEX_STATUS_OPERATION,
  'projectFileRead',
  'projectFileBlame',
  'guiFileApplications', 'guiFilePreviewClose', 'guiFilePreviewHost', 'guiFilePreviewText', 'guiResourceClose',
  'suggestNextPrompt',
  PROJECT_LIST_OPERATION,
  'downloadOpen', 'downloadBrowse', 'previewOpen',
  'guiCliStatus', 'guiCliRelease', 'guiTerminalRead', 'guiTerminalList', 'guiTerminalSshProfiles',
  'guiGitChanges', 'guiGitDiff', 'guiGitHistory', 'guiGitRepository', 'guiGitCommitFiles',
  'fileOpen', 'fileRead', 'fileClose',
  CONTEXT_READ_OPERATION,
  TOKEN_SUMMARY_OPERATION,
  'usageSummary',
  CONVERSATION_METRICS_OPERATION,
  'projectDirectories',
  'videoOpen', 'videoRead', 'videoClose',
  'textPreview',
  'cozeCatalog',
  'guiAccountsRead', 'syncHistory', 'imageChunk', 'imagePreview', 'models', 'list', 'read', 'goalGet', 'skills', 'projectFiles', 'queueRead',
]);
const QUEUE_OPERATIONS = new Set([
  'queueRead', 'queueEnqueue', 'queueSendNow', 'queueRemove', 'queueFlush', 'queueEdit', 'queueMoveUp', 'queueMoveDown',
]);

function operationError(error: unknown) {
  // Tauri rejects with the safe string produced by the Rust command boundary.
  if (typeof error === 'string' && error.trim()) return error;
  return error instanceof Error ? error.message : '电脑暂时无法处理请求，请稍后重试。';
}

function response(request: RpcRequest, data: unknown, mode: ConnectionMode): RpcResponse {
  const result: RpcResponse = { kind: 'response', id: request.id, data };
  // Fail just this request if an image/history exceeds the transport limit, preserving the connection.
  chunks(result, request.id, mode).next();
  return result;
}

export class ChatOperations {
  readonly views = new ConversationViews();
  private readonly dictation = new RemoteDictation();
  private readonly files = new RemoteFiles();
  attachMappingStreams(owner: string, link: import('../../../../shared/remote-chat/link').ChatLink) {
    this.files.attach(owner, link);
  }
  readonly desktop = new RemoteDesktopHost();
  constructor(private readonly terminals: RemoteTerminals = remoteTerminals) {}
  private readonly cache = new Map<string, Cached>();
  private readonly images = new RemoteImages();
  private readonly liveHistory = new LiveHistory();
  private readonly commandMetrics = new CommandMetricsStore();
  private readonly titles = new RemoteThreadTitles();

  execute(request: RpcRequest, mode: ConnectionMode = 'relay', owner = 'default', terminalOwner = owner)
    : Promise<RpcResponse> {
    if (typeof request.id !== 'string' || request.id.length > 160) return Promise.reject(new Error('Invalid request'));
    const operation = (request.body as { operation?: string } | undefined)?.operation;
    const serialized = JSON.stringify([request.method, request.body]);
    // Retry matching must not retain SSH credentials or uploaded file contents in the response cache.
    const fingerprint = operation === DICTATION_OPERATION
      || (typeof operation === 'string' && operation.startsWith('guiTerminalSsh'))
      ? bytesToHex(sha256(new TextEncoder().encode(serialized))) : serialized;
    const cacheKey = JSON.stringify([owner, request.id]);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (cached.fingerprint !== fingerprint) return Promise.reject(new Error('Request id reused'));
      return cached.result;
    }
    this.pruneTerminalLink(request, owner);
    this.prune();
    if (this.cache.size >= 512) return Promise.reject(new Error('请求较多，请稍后重试。'));
    const running = this.dispatch(request, { mode, owner, terminalOwner });
    const result = running.then((data) => response(request, data, mode))
      .catch((error: unknown): RpcResponse => ({ kind: 'response', id: request.id, error: operationError(error) }));
    const readOnly = request.method === 'request' && (READ_OPERATIONS.has(operation ?? '')
      || (operation === 'guiGitSettings' && object(request.body).autoMessage === undefined)
      || (operation === 'guiGitWorkspace' && object(object(request.body).request).operation === 'status')
      || (operation === DESKTOP_OPERATION && object(request.body).action === 'signal'));
    const entry: Cached = { fingerprint, result, expires: Date.now() + CACHE_TTL_MS, completed: false, readOnly };
    entry.terminalLink = terminalLinkRequest(request);
    if (entry.terminalLink) {
      entry.readOnly = entry.terminalLink.action === 'close'; // Closing a closed stream is safe to repeat.
    }
    this.cache.set(cacheKey, entry);
    void result.then(reply => {
      entry.completed = true;
      if (entry.terminalLink?.action === 'connect' && !reply.error) {
        entry.terminalLink.stream = (reply.data as { id?: string } | undefined)?.id;
      }
      if (entry.terminalLink && reply.error) entry.readOnly = true;
      // Range reads are repeatable; caching their payloads would retain an entire file in memory.
      // Upload chunks retry fixed ranges; retaining every acknowledgement would cap large uploads at 512 requests.
      if (operation === 'videoRead' || operation === 'fileRead' || operation === 'projectFileRead'
        || operation === 'toolDetails'
        || operation === 'projectFileBlame'
        || operation === 'guiFilePreviewText'
        || (operation === 'projectFileWrite' && typeof object(request.body).upload === 'object'
          && object(request.body).upload !== null && !Array.isArray(object(request.body).upload)
          && !(object(request.body).upload as Record<string, unknown>).finish)
        || (operation === 'guiTerminalSshFiles' && ['read', 'readChunk', 'list', 'uploadChunk']
          .includes(String(object(object(request.body).request).type)))
        || operation === 'guiTerminalSshProbe' || operation === 'guiTerminalSshProfiles'
        || (operation === 'guiTerminalRead' && object(request.body).cursor !== undefined)) this.cache.delete(cacheKey);
    });
    return result;
  }

  release(owner?: string) {
    this.views.release(owner);
    this.dictation.release(owner);
    this.files.release(owner);
    this.desktop.release(owner);
    if (owner === undefined) { this.titles.clear(); this.commandMetrics.clear(); }
    for (const key of this.cache.keys()) {
      if (owner === undefined || (JSON.parse(key) as string[])[0] === owner) this.cache.delete(key);
    }
  }

  private async dispatch(request: RpcRequest, options: { mode: ConnectionMode; owner: string; terminalOwner: string }) {
    if (request.method === 'request') {
      const body = object(request.body);
      if (body.operation === DICTATION_OPERATION) return this.dictation.request(body, options.owner);
      if (GUI_FILE_OPERATIONS.has(String(body.operation))) return this.files.request(body, options.owner);
      if (body.operation === DESKTOP_OPERATION) return this.desktop.request(request.body, options.owner);
    }
    return this.run(request, options.mode, options.terminalOwner);
  }

  private pruneTerminalLink(request: RpcRequest, owner: string) {
    const stream = terminalLinkRequest(request);
    if (!stream || !['read', 'write', 'close'].includes(String(stream.action))) return;
    // The next request in each single-flight direction acknowledges the preceding response.
    // Keep that response until then so transport retries cannot consume or write bytes twice.
    for (const [key, entry] of this.cache) {
      if (!entry.completed || (JSON.parse(key) as string[])[0] !== owner) continue;
      const previous = entry.terminalLink;
      if (previous && previous.terminal === stream.terminal && previous.stream === stream.stream
        && (stream.action === 'close' || previous.action === 'connect' || previous.action === stream.action)) {
        this.cache.delete(key);
      }
    }
  }

  private async run(request: RpcRequest, mode: ConnectionMode, owner: string): Promise<unknown> {
    if (request.method === 'connect') return this.connect(request.body);
    const body = { ...object(request.body) };
    if (request.method === 'request' && body.operation === 'viewThread') {
      await this.views.select(owner, body.threadId, true, body.deferToolDetails === true);
      return {};
    }
    if (request.method === 'request' && ['syncHistory', 'read'].includes(String(body.operation))) {
      await this.views.select(owner, body.threadId, false, body.deferToolDetails === true);
      body.includeToolDetails = !this.views.deferred(owner);
    }
    if (request.method === 'request' && body.operation === GROUPS_OPERATION) return remoteGroups(body);
    if (request.method === 'request' && ['editMessage', 'deleteMessage'].includes(String(body.operation))) {
      return this.images.prepare(await changeRemoteMessage(body), String(body.threadId));
    }
    if (request.method === 'request' && body.operation === 'delete') return deleteRemoteThread(body.threadId);
    if (request.method === 'request' && body.operation === 'threadPin') return pinRemoteThread(body);
    if (request.method === 'request'
      && [PROJECT_PIN_OPERATION, PROJECT_REMOVE_OPERATION].includes(String(body.operation))) {
      return changeRemoteProject(body);
    }
    if (request.method === 'request' && body.operation === 'forkLatest') return forkRemoteConversation(body.threadId);
    if (request.method === 'request' && GUI_TOOL_OPERATIONS.has(String(body.operation))) {
      return String(body.operation).startsWith('guiTerminal')
        ? this.terminals.request(body, owner) : guiToolRequest(body);
    }
    if (request.method === 'request'
      && [CONTEXT_READ_OPERATION, CONTEXT_WRITE_OPERATION].includes(String(body.operation))) {
      return contextSettingsRequest(body);
    }
    if (request.method === 'request' && body.operation === TOKEN_SUMMARY_OPERATION) {
      const summary = await readTokenSummary(body.weeks);
      return body.quotaHistoryFormat === QUOTA_HISTORY_FORMAT ? encodeTokenSummary(summary) : summary;
    }
    if (request.method === 'request' && body.operation === 'usageSummary') {
      return invoke<UsageSummary>('codex_gui_usage_summary');
    }
    if (request.method === 'request' && body.operation === CONVERSATION_METRICS_OPERATION) {
      if (typeof body.threadId !== 'string' || !body.threadId.trim()) throw new Error('请选择聊天后重试。');
      const metrics = await invoke<ConversationMetrics>('get_proxy_session_metrics', { threadId: body.threadId });
      return { ...metrics, ...this.commandMetrics.read(body.threadId) };
    }
    if (request.method === 'request' && body.operation === 'guiAccountsRead') return readGuiAccounts();
    if (request.method === 'request' && body.operation === 'guiAccountSelect') return selectGuiAccount(body.selection);
    if (request.method === 'request' && QUEUE_OPERATIONS.has(String(body.operation))) {
      return remoteQueue.request(body, mode);
    }
    if (request.method === 'request' && ['imagePreview', 'imageChunk'].includes(String(body.operation))) {
      return this.images.request(body, mode);
    }
    if (request.method === 'request' && body.operation === 'syncHistory') {
      if (typeof body.threadId !== 'string') throw new Error('请选择聊天后重试。');
      const known = parseHistoryVersion(body.known);
      const window = parseHistoryWindow(body.window);
      const threadId = body.threadId;
      let page: HistoryPage | undefined;
      const thread = await this.liveHistory.read(threadId, async () => {
        const result = await guiApi.request<{ thread: Thread; page?: HistoryPage }>({ operation: 'read', threadId,
          includeToolDetails: !this.views.deferred(owner),
          window: { ...window, pageSize: getChatPolicy().historyPageSize } });
        page = result.page;
        return result;
      });
      const current = effectiveProjectThread(this.views.deferred(owner) ? summarizeTools(thread) : thread);
      this.commandMetrics.seed(current);
      const sliced = sliceHistory(acknowledgedMessages.merge(current), page ? { start: page.start } : window);
      return { ...historyDelta(this.images.prepare(sliced.thread, thread.id), known),
        page: { ...sliced.page, hasMore: Boolean(page?.hasMore || sliced.page.hasMore) } };
    }
    if (request.method === 'request' && body.operation === 'composerSet') {
      return guiComposer.update(body.settings, composerThreadId(body.threadId));
    }
    if (request.method === 'request' && body.operation === 'threadRead') return guiSidebar.markRead(body);
    if (request.method === 'request' && (body.operation === 'models' || body.operation === 'modelsRefresh')) {
      const threadId = composerThreadId(body.threadId);
      const composer = body.operation === 'modelsRefresh'
        ? await guiComposer.refreshModels(threadId) : await guiComposer.read(threadId);
      return { data: composer.models, nextCursor: null, composer };
    }
    if (request.method === 'respond') {
      if (typeof body.id !== 'string' && typeof body.id !== 'number') throw new Error('审批请求已失效，请刷新对话。');
      return guiApi.respond(body as ApprovalReply);
    }
    if (request.method !== 'request' || !OPERATIONS.has(String(body.operation))) {
      throw new Error('当前手机端暂不支持此操作。');
    }
    if (body.operation === 'start' || body.operation === 'send') {
      const settings = await guiComposer.validateSend({
        threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
        effort: typeof body.effort === 'string' ? body.effort : undefined,
      });
      body.model = settings.model;
      if (body.operation === 'send') body.effort = settings.effort;
    }
    // The existing typed Rust boundary validates directories, thread ids, inputs and approval replies.
    const sidebarVersion = guiSidebar.version();
    if (body.operation === 'send' || body.operation === 'steer') {
      // Derive the upload provenance from this session, never from the remote request body.
      body.transferMode = mode === 'direct' ? 'direct' : 'relay';
      if (body.attachments !== undefined) body.attachments = remoteAttachments(body.attachments, mode);
    }
    if (body.operation === 'textPreview') body.maxBytes = textPreviewByteLimit(mode);
    if (body.operation === 'previewOpen') {
      body.maxBytes = body.preview === 'text' ? textPreviewByteLimit(mode) : imagePreviewByteLimit(mode);
      if (body.preview !== 'text') body.path = await this.images.downloadSource(body.threadId, body.path);
    }
    if (body.operation === 'fileOpen' || body.operation === 'fileRead' || body.operation === 'downloadOpen') {
      body.maxBytes = fileDownloadByteLimit(mode);
    }
    if (body.operation === 'videoOpen' || body.operation === 'videoRead') {
      body.maxBytes = videoByteLimit(mode);
    }
    applyProjectOverride(body);
    const result = body.operation === 'list' ? await readRemoteThreadList(body)
      : body.operation === 'send' ? await sendRemoteMessage(body as Extract<Request, { operation: 'send' }>)
      : await guiApi.request(body as unknown as Request);
    completeRemoteThreadListWrite(body, result);
    // File documents must stay byte-faithful; conversation image rewriting would corrupt embedded data URLs.
    if (['projectFileRead', 'projectFileBlame', 'projectFileWrite', 'projectEntryAction']
      .includes(String(body.operation))) return result;
    this.titles.completed(body, result);
    if (body.operation === 'skills') return composerCatalog(result as SkillsResponse, body);
    if (body.operation === 'list') {
      const list = result as ListResponse<Thread>;
      return { ...list, data: list.data.map(({ turns: _turns, ...thread }) => effectiveProjectThread(thread)),
        sidebar: guiSidebar.observe(list.data, sidebarVersion) };
    }
    if (body.operation === 'resume' || body.operation === 'send' || body.operation === 'steer') return {};
    if (body.operation === 'read') {
      const response = result as { thread: Thread };
      this.commandMetrics.seed(response.thread);
      return this.images.prepare({ ...response, thread: effectiveProjectThread(response.thread) }, String(body.threadId));
    }
    return this.images.prepare(result, String(body.threadId ?? ''));
  }

  private async connect(body: unknown) {
    validateChatHandshake(body);
    try {
      const approvals = await guiApi.connect({ reuseExisting: true });
      this.titles.refreshSettings();
      return body === undefined ? approvals
        : { ...chatHandshake, approvals, fileBulkV1: true, filePreviewsV1: true, portStreamsV1: true,
          conversationViewsV1: true };
    } catch (error) { throw new Error(guiConnectionError(error)); }
  }

  prepareEvent(event: GuiEvent) {
    receiveRemoteThreadListEvent(event);
    this.liveHistory.receive(event);
    this.commandMetrics.receive(event);
    if (event.params.thread) {
      event = { ...event, params: { ...event.params, thread: effectiveProjectThread(event.params.thread) } };
    }
    return this.images.prepare(historyNotification(event), event.params.threadId ?? event.params.thread?.id ?? '');
  }

  private prune() {
    for (const [id, entry] of this.cache) if (entry.completed && entry.expires <= Date.now()) this.cache.delete(id);
    // Frequent history/image reads must not exhaust the retry cache reserved for exactly-once mutations.
    for (const [id, entry] of this.cache) {
      if (this.cache.size < 512) break;
      if (entry.completed && entry.readOnly) this.cache.delete(id);
    }
  }
}
