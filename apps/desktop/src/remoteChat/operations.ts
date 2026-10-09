import { fileDownloadByteLimit, getChatPolicy, imagePreviewByteLimit, textPreviewByteLimit, videoByteLimit }
  from '../../../../shared/remote-chat/policy';
import { remoteAttachments } from '../../../../shared/remote-chat/composerAttachments';
import { guiApi } from '../pages/codexGui/api';
import type { ApprovalReply, GuiEvent, ListResponse, Request, SkillsResponse, Thread } from '../pages/codexGui/types';
import { object, type ConnectionMode, type RpcRequest, type RpcResponse }
  from '../../../../shared/remote-chat/protocol';
import { chunks } from '../../../../shared/remote-chat/framing';
import { guiComposer } from '../pages/codexGui/composerBridge';
import { composerThreadId } from '../../../../shared/remote-chat/composer';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';
import { historyDelta, parseHistoryVersion } from '../../../../shared/remote-chat/historySync';
import { RemoteImages } from './images';
import { parseHistoryWindow, sliceHistory } from '../../../../shared/remote-chat/historyPage';
import { historyNotification } from '../../../../shared/remote-chat/historyNotification';
import { LiveHistory } from './liveHistory';
import { composerCatalog } from './composerCatalog';
import { remoteQueue } from './queue';
import { readGuiAccounts, selectGuiAccount } from './guiAccounts';
import { acknowledgedMessages } from './acknowledgedMessages';
import { chatHandshake, validateChatHandshake } from '../../../../shared/remote-chat/handshake';
import { guiConnectionError } from '../../../../shared/remote-chat/connectionErrors';
import { invoke } from '../api/backend';
import type { UsageSummary } from '../../../../shared/remote-chat/usage';
import { TOKEN_SUMMARY_OPERATION } from '../../../../shared/remote-chat/tokenSummary';
import { encodeTokenSummary, QUOTA_HISTORY_FORMAT } from '../../../../shared/remote-chat/tokenSummaryCodec';
import { readTokenSummary } from './tokenSummary';
import { CONTEXT_READ_OPERATION, CONTEXT_WRITE_OPERATION } from '../../../../shared/remote-chat/contextSettings';
import { contextSettingsRequest } from './contextSettings';
import { GUI_TOOL_OPERATIONS } from '../../../../shared/remote-chat/guiTools';
import { guiToolRequest } from './guiTools';
import { remoteTerminals, type RemoteTerminals } from './terminals';
import { deleteRemoteThread } from './threadActions';
import { RemoteDesktopHost } from '../remoteDesktop/host';
import { DESKTOP_OPERATION } from '../../../../shared/remote-desktop/protocol';
import { RemoteThreadTitles } from './threadTitles';
import { applyProjectOverride, effectiveProjectThread } from './projects';
import { PROJECT_LIST_OPERATION } from '../../../../shared/remote-chat/projects';

const OPERATIONS = new Set([
  'downloadOpen', 'downloadBrowse', 'previewOpen',
  'fileOpen', 'fileRead', 'fileClose',
  'videoOpen', 'videoRead', 'videoClose',
  'projectDirectories',
  'models', 'list', 'read', 'start', 'resume', 'send', 'steer', 'interrupt', 'rename', 'archive', 'unarchive',
  'compact', 'skills', 'projectFiles', 'imagePreview', 'textPreview', 'goalGet', 'goalSet', 'goalClear',
]);
const CACHE_TTL_MS = 5 * 60_000;
interface Cached {
  fingerprint: string; result: Promise<RpcResponse>; expires: number; completed: boolean; readOnly: boolean;
}
const READ_OPERATIONS = new Set([
  PROJECT_LIST_OPERATION,
  'downloadOpen', 'downloadBrowse', 'previewOpen',
  'guiCliStatus', 'guiCliRelease', 'guiTerminalRead', 'guiTerminalList',
  'guiGitChanges', 'guiGitDiff', 'guiGitHistory', 'guiGitRepository', 'guiGitCommitFiles',
  'fileOpen', 'fileRead', 'fileClose',
  CONTEXT_READ_OPERATION,
  TOKEN_SUMMARY_OPERATION,
  'usageSummary',
  'projectDirectories',
  'videoOpen', 'videoRead', 'videoClose',
  'textPreview',
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
  readonly desktop = new RemoteDesktopHost();
  constructor(private readonly terminals: RemoteTerminals = remoteTerminals) {}
  private readonly cache = new Map<string, Cached>();
  private readonly images = new RemoteImages();
  private readonly liveHistory = new LiveHistory();
  private readonly titles = new RemoteThreadTitles();

  execute(request: RpcRequest, mode: ConnectionMode = 'relay', owner = 'default', terminalOwner = owner)
    : Promise<RpcResponse> {
    if (typeof request.id !== 'string' || request.id.length > 160) return Promise.reject(new Error('Invalid request'));
    const fingerprint = JSON.stringify([request.method, request.body]);
    const cacheKey = JSON.stringify([owner, request.id]);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (cached.fingerprint !== fingerprint) return Promise.reject(new Error('Request id reused'));
      return cached.result;
    }
    this.prune();
    if (this.cache.size >= 512) return Promise.reject(new Error('请求较多，请稍后重试。'));
    const operation = (request.body as { operation?: string } | undefined)?.operation;
    const running = request.method === 'request' && operation === DESKTOP_OPERATION
      ? this.desktop.request(request.body, owner) : this.run(request, mode, terminalOwner);
    const result = running.then((data) => response(request, data, mode))
      .catch((error: unknown): RpcResponse => ({ kind: 'response', id: request.id, error: operationError(error) }));
    const readOnly = request.method === 'request' && (READ_OPERATIONS.has(operation ?? '')
      || (operation === 'guiGitWorkspace' && object(object(request.body).request).operation === 'status')
      || (operation === DESKTOP_OPERATION && object(request.body).action === 'signal'));
    const entry: Cached = { fingerprint, result, expires: Date.now() + CACHE_TTL_MS, completed: false, readOnly };
    this.cache.set(cacheKey, entry);
    void result.then(() => {
      entry.completed = true;
      // Range reads are repeatable; caching their payloads would retain an entire file in memory.
      if (operation === 'videoRead' || operation === 'fileRead'
        || (operation === 'guiTerminalRead' && object(request.body).cursor !== undefined)) this.cache.delete(cacheKey);
    });
    return result;
  }

  release(owner?: string) {
    this.desktop.release(owner);
    if (owner === undefined) this.titles.clear();
    for (const key of this.cache.keys()) {
      if (owner === undefined || (JSON.parse(key) as string[])[0] === owner) this.cache.delete(key);
    }
  }

  private async run(request: RpcRequest, mode: ConnectionMode, owner: string): Promise<unknown> {
    if (request.method === 'connect') return this.connect(request.body);
    const body = { ...object(request.body) };
    if (request.method === 'request' && body.operation === 'delete') return deleteRemoteThread(body.threadId);
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
      const { thread } = await guiApi.request<{ thread: Thread }>({ operation: 'read', threadId: body.threadId });
      const current = effectiveProjectThread(this.liveHistory.merge(thread));
      const sliced = sliceHistory(acknowledgedMessages.merge(current), window);
      return { ...historyDelta(this.images.prepare(sliced.thread, thread.id), known), page: sliced.page };
    }
    if (request.method === 'request' && body.operation === 'composerSet') {
      return guiComposer.update(body.settings, composerThreadId(body.threadId));
    }
    if (request.method === 'request' && body.operation === 'threadRead') return guiSidebar.markRead(body);
    if (request.method === 'request' && body.operation === 'models') {
      const composer = await guiComposer.read(composerThreadId(body.threadId));
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
    if (body.operation === 'list') body.limit = getChatPolicy().threadPageSize;
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
    const result = await guiApi.request(body as unknown as Request);
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
      return this.images.prepare({ ...response, thread: effectiveProjectThread(response.thread) }, String(body.threadId));
    }
    return this.images.prepare(result, String(body.threadId ?? ''));
  }

  private async connect(body: unknown) {
    validateChatHandshake(body);
    try {
      const approvals = await guiApi.connect({ reuseExisting: true });
      this.titles.refreshSettings();
      return body === undefined ? approvals : { ...chatHandshake, approvals, fileBulkV1: true, filePreviewsV1: true };
    } catch (error) { throw new Error(guiConnectionError(error)); }
  }

  prepareEvent(event: GuiEvent) {
    this.liveHistory.receive(event);
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
