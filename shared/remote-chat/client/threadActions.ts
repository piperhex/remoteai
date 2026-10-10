import type { ChatState, Thread } from './types';

export type ThreadAction = 'rename' | 'archive' | 'unarchive' | 'delete' | 'pin' | 'unpin';
export type ThreadMutation = { operation: 'rename'; threadId: string; name: string }
  | { operation: 'threadPin'; threadId: string; pinned: boolean }
  | { operation: 'archive' | 'unarchive' | 'delete'; threadId: string };
// Match the desktop editor and stay below the host's UTF-8 byte limit for Chinese names.
export const THREAD_NAME_LIMIT = 120;
export const THREAD_LONG_PRESS_MS = 500;

export function threadActionReason(state: ChatState, thread: Thread, action: ThreadAction): string {
  if (!state.ready) return '连接电脑后即可管理对话。';
  if (state.threadActionBusy || state.sending) return '请等待当前操作完成。';
  if (action === 'pin' || action === 'unpin') return '';
  const current = state.selected?.id === thread.id ? state.selected
    : state.threads.find(item => item.id === thread.id) ?? thread;
  if (state.compacting === thread.id || state.sidebar.threads[thread.id]?.running
    || current.status?.type === 'active' || current.turns?.some(turn => turn.status === 'inProgress')
    || state.approvals.some(event => event.params.threadId === thread.id)) {
    return '请等待回复结束后再操作。';
  }
  if (action !== 'rename' && state.queue.threads[thread.id]?.length) {
    return '请先发送或删除待发送消息。';
  }
  return '';
}

interface Context {
  snapshot: () => ChatState;
  update: (patch: Partial<ChatState>) => void;
  request: (body: ThreadMutation) => Promise<unknown>;
  complete: (body: ThreadMutation, result?: unknown) => void;
  refresh: () => Promise<void>;
}

/** Serialize mutations and validate against the latest state, including after a confirmation stays open. */
export class ThreadActions {
  constructor(private readonly context: Context) {}

  async run(thread: Thread, action: ThreadAction, name = '') {
    const reason = threadActionReason(this.context.snapshot(), thread, action);
    if (reason) throw new Error(reason);
    const trimmed = name.trim();
    if (action === 'rename' && (!trimmed || trimmed.length > THREAD_NAME_LIMIT)) {
      throw new Error('请输入 1 至 120 个字符的对话名称。');
    }
    const body: ThreadMutation = action === 'pin' || action === 'unpin'
      ? { operation: 'threadPin', threadId: thread.id, pinned: action === 'pin' } : action === 'rename'
      ? { operation: action, threadId: thread.id, name: trimmed } : { operation: action, threadId: thread.id };
    this.context.update({ threadActionBusy: thread.id, error: '' });
    try {
      const result = await this.context.request(body);
      if (body.operation === 'threadPin') this.context.complete(body, result);
      else this.context.complete(body);
      await this.context.refresh();
    } finally { this.context.update({ threadActionBusy: undefined }); }
  }
}

export function threadMutationPatch(state: ChatState, body: ThreadMutation): Partial<ChatState> {
  const { threadId, operation } = body;
  if (operation === 'threadPin') return {};
  const sidebar = { ...state.sidebar, threads: { ...state.sidebar.threads }, readState: { ...state.sidebar.readState } };
  if (operation === 'rename') {
    if (sidebar.threads[threadId]) sidebar.threads[threadId] = { ...sidebar.threads[threadId], title: body.name };
    return { sidebar, threads: state.threads.map(thread => thread.id === threadId ? { ...thread, name: body.name } : thread),
      selected: state.selected?.id === threadId ? { ...state.selected, name: body.name } : state.selected };
  }
  delete sidebar.threads[threadId]; delete sidebar.readState[threadId];
  const queue = { ...state.queue, threads: { ...state.queue.threads } };
  const goals = { ...state.goals };
  delete queue.threads[threadId]; delete goals[threadId];
  return { sidebar, queue, goals, threads: state.threads.filter(thread => thread.id !== threadId),
    cachedThreadIds: operation === 'delete' ? state.cachedThreadIds?.filter(id => id !== threadId) : state.cachedThreadIds,
    approvals: state.approvals.filter(event => event.params.threadId !== threadId) };
}
