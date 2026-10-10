import { guiApi } from '../pages/codexGui/api';
import { getGuiController } from '../pages/codexGui/session';
import { isThreadRunning } from '../pages/codexGui/threadRunning';
import type { Thread } from '../pages/codexGui/types';

/** Branch on the host so history and model choices stay scoped to the requested conversation. */
export async function forkRemoteConversation(threadId: unknown) {
  if (typeof threadId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(threadId)) {
    throw new Error('请选择有效的对话。');
  }
  const controller = getGuiController();
  if (controller.getSnapshot().connection !== 'ready') await controller.connect({ reuseExisting: true });
  const selection = await controller.modelSettings.ready(threadId);
  const { thread: source } = await guiApi.request<{ thread: Thread }>({ operation: 'read', threadId });
  const state = controller.getSnapshot();
  const turn = source.turns?.at(-1);
  if (state.connection !== 'ready' || state.workspaceBusy || state.deleting || state.compacting === threadId) {
    throw new Error('请等待当前操作完成。');
  }
  if (isThreadRunning(state, source) || turn?.status === 'inProgress'
    || state.approvals.some(event => event.params.threadId === threadId)) {
    throw new Error('请等待当前回复完成后，再创建分支。');
  }
  if (state.queued[threadId]?.length) throw new Error('请先发送或删除待发送消息。');
  if (!turn) throw new Error('这条对话还没有可用于创建分支的消息。');
  const { thread } = await guiApi.request<{ thread: Thread }>({ operation: 'fork', threadId, turnId: turn.id,
    access: state.settings.access, cwd: state.projectOverrides[threadId] });
  controller.modelSettings.created(thread.id, selection);
  await controller.modelSettings.ready(thread.id);
  void controller.refresh();
  // The client loads paged history after opening the fork; avoid sending its entire history over the relay.
  const { turns: _turns, ...summary } = thread;
  return { thread: summary };
}
