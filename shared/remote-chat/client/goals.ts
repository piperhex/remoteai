import type { ThreadGoal } from '../../../apps/desktop/src/pages/codexGui/goalTypes';
import type { ChatState, Request, SendInput, Thread } from './types';
import type { ComposerSettings } from '../composer';

interface Host {
  snapshot: () => ChatState;
  update: (patch: Partial<ChatState>) => void;
  request: <T>(body: Request) => Promise<T>;
  created: (id: string, settings: ComposerSettings) => Promise<unknown>;
  generation: () => number;
}

export class RemoteGoals {
  constructor(private host: Host) {}
  private update = (threadId: string, goal: ThreadGoal | null) => {
    this.host.update({ goals: { ...this.host.snapshot().goals, [threadId]: goal } });
  };
  load = async (threadId: string) => {
    const generation = this.host.generation();
    const before = this.host.snapshot().goals?.[threadId];
    try {
      const { goal } = await this.host.request<{ goal: ThreadGoal | null }>({ operation: 'goalGet', threadId });
      if (generation === this.host.generation() && this.host.snapshot().goals?.[threadId] === before) {
        this.update(threadId, goal);
      }
    } catch { /* Older computers may not support goals; ordinary chat remains available. */ }
  };
  private unavailable = () => {
    const state = this.host.snapshot();
    return !state.ready || state.sending || state.workspaceBusy || state.settingsBusy
      || state.goalBusy || state.selectedArchived
      || !!state.compacting || state.selected?.turns?.some((turn) => turn.status === 'inProgress')
      || state.approvals.some((event) => event.params.threadId === state.selected?.id);
  };
  private prepare = async (input: SendInput, generation: number) => {
    const state = this.host.snapshot();
    const selection = { ...state.settings, model: input.model ?? state.settings.model,
      effort: input.effort ?? state.settings.effort, access: input.access };
    if (state.selected) {
      await this.host.request({ operation: 'resume', threadId: state.selected.id, access: input.access });
      const { thread } = await this.host.request<{ thread: Thread }>({ operation: 'read', threadId: state.selected.id });
      if (thread.turns?.some((turn) => turn.status === 'inProgress')
        || this.host.snapshot().selected?.turns?.some((turn) => turn.status === 'inProgress')) {
        throw new Error('请等待当前任务结束。');
      }
      return thread.id;
    }
    const { thread } = await this.host.request<{ thread: Thread }>({ operation: 'start',
      cwd: state.draftProject?.cwd, model: selection.model || undefined, access: input.access });
    if (generation !== this.host.generation() || !this.host.snapshot().ready) throw new Error('连接已中断。');
    this.host.update({ selected: thread, draftProject: null, selectedArchived: false,
      threads: [thread, ...this.host.snapshot().threads.filter((entry) => entry.id !== thread.id)] });
    await this.host.created(thread.id, selection);
    return thread.id;
  };
  start = async (input: SendInput) => {
    if (this.unavailable()) return false;
    const state = this.host.snapshot();
    if (state.selected && state.queue.threads[state.selected.id]?.length) {
      this.host.update({ error: '请先处理待发送消息，再开始目标。' }); return false;
    }
    if (!input.text.trim() || input.text.length > 4000 || input.images?.length
      || input.skills?.length || input.attachments?.length) {
      this.host.update({ error: '请用 4000 字以内的文字描述目标；图片、文件和技能可退出目标模式后发送。' });
      return false;
    }
    const generation = this.host.generation();
    this.host.update({ sending: true, goalBusy: true, error: '' });
    try {
      const threadId = await this.prepare(input, generation);
      if (generation !== this.host.generation() || !this.host.snapshot().ready
        || this.host.snapshot().selected?.id !== threadId) return false;
      const before = this.host.snapshot().goals?.[threadId];
      const { goal } = await this.host.request<{ goal: ThreadGoal }>({ operation: 'goalSet', threadId,
        objective: input.text.trim(), status: 'active' });
      if (generation !== this.host.generation()) return false;
      if (this.host.snapshot().goals?.[threadId] === before) this.update(threadId, goal);
      return true;
    } catch {
      this.host.update({ error: '目标未能开始，请等待当前任务结束后重试。' }); return false;
    } finally { this.host.update({ sending: false, goalBusy: false }); }
  };
  clear = async (threadId: string) => {
    const state = this.host.snapshot();
    if (!state.ready || state.sending || state.goalBusy || state.selectedArchived || state.selected?.id !== threadId) {
      return false;
    }
    const generation = this.host.generation();
    this.host.update({ goalBusy: true, error: '' });
    try {
      await this.host.request({ operation: 'goalClear', threadId });
      if (generation !== this.host.generation()) return false;
      this.update(threadId, null); return true;
    } catch { this.host.update({ error: '目标未能移除，请稍后重试。' }); return false; }
    finally { this.host.update({ goalBusy: false }); }
  };
  pause = async (threadId: string) => {
    const before = this.host.snapshot().goals?.[threadId];
    if (before?.status !== 'active') return;
    const { goal } = await this.host.request<{ goal: ThreadGoal }>({ operation: 'goalSet', threadId, status: 'paused' });
    if (this.host.snapshot().goals?.[threadId] === before) this.update(threadId, goal);
  };
}
