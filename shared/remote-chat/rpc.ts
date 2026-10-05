import { REQUEST_TIMEOUT_MS, type RpcMessage, type RpcRequest } from './protocol';
import { CONNECTION_ERRORS } from './connectionErrors';
import { chatMessageCharLimit } from './framing';
import type { TransferProgress } from './uploadProgress';
import { taskRequest, type TaskDelivery } from './taskDelivery';
import { BULK_LIMITS } from './bulkLimits';
import { recordDownloadRpcLatency } from './downloadMetrics';

const TRANSFER_CHARS_PER_SECOND = 128 * 1024;
const SMALL_REQUEST_CHARS = 1024 * 1024;
const MAX_TIMER_MS = 2_147_483_647;
const GIT_ACTION_TIMEOUT_MS = 5 * 60_000;
function requestTimeout(body: unknown) {
  const operation = (body as { operation?: unknown } | null)?.operation;
  if (operation === 'guiGitAction') return GIT_ACTION_TIMEOUT_MS;
  if (operation === 'fileBulk' && (body as { action?: string }).action === 'open') return BULK_LIMITS.prepareMs;
  // The direct size allowance is not a transfer estimate and must not turn a timeout into a multi-day wait.
  const chars = operation === 'queueEdit' ? chatMessageCharLimit('relay') : (JSON.stringify(body)?.length ?? 0);
  const transferMs = Math.ceil(Math.max(0, chars - SMALL_REQUEST_CHARS) / TRANSFER_CHARS_PER_SECOND) * 1000;
  return Math.min(MAX_TIMER_MS, REQUEST_TIMEOUT_MS + transferMs);
}

interface Pending {
  started: number;
  progress?: TransferProgress;
  request: RpcRequest;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ChatRpc {
  private sequence = 0;
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly options: {
    send: (message: RpcMessage, progress?: TransferProgress) => Promise<void>;
    event: (event: unknown) => void;
    prefix: string;
    delivery?: (value: TaskDelivery) => void;
  }) {}

  request<T>(method: RpcRequest['method'], body?: unknown, progress?: TransferProgress): Promise<T> {
    if (this.pending.size >= 32) return Promise.reject(new Error('请求较多，请稍后重试。'));
    const id = `${this.options.prefix}:${++this.sequence}`;
    const request: RpcRequest = { kind: 'request', id, method, body };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.report(request, 'unknown');
        reject(new Error(method === 'connect' ? CONNECTION_ERRORS.guiTimeout
          : '电脑暂未确认结果，请刷新对话后再试，避免重复发送。'));
      }, requestTimeout(body));
      const report: TransferProgress | undefined = progress
        ? (fraction, items) => {
          if (!this.pending.has(id)) return;
          if (items) progress(fraction, items);
          else progress(fraction);
        } : undefined;
      this.pending.set(id, { request, resolve: (value) => resolve(value as T), reject, timer, progress: report,
        started: performance.now() });
      this.report(request, 'sending');
      void this.options.send(request, report).then(() => {
        if (this.pending.has(id)) this.report(request, 'sent');
      }).catch((error: unknown) => this.fail(id, error));
    });
  }

  receive(message: RpcMessage) {
    if (message.kind === 'event') { this.options.event(message.event); return; }
    if (message.kind !== 'response') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    recordDownloadRpcLatency(performance.now() - pending.started);
    this.report(pending.request, message.error ? 'unknown' : 'received');
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.data);
  }

  retry() {
    // Same ids survive a path switch; the PC caches completed and in-flight operations.
    for (const { request, progress } of this.pending.values()) {
      void this.options.send(request, progress).catch((error: unknown) => this.fail(request.id, error));
    }
  }

  private fail(id: string, error: unknown) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    this.report(pending.request, 'unknown');
    pending.reject(error instanceof Error ? error : new Error('连接已中断。'));
  }

  close() {
    for (const id of this.pending.keys()) this.fail(id, new Error('连接已中断，请重新连接电脑。'));
  }

  private report(request: RpcRequest, phase: TaskDelivery['phase']) {
    const task = taskRequest(request);
    if (task) this.options.delivery?.({ ...task, phase });
  }
}
