import { guiApi } from '../../../../shared/conversation/api';
import { getGuiController } from '../pages/codexGui/session';
import { canEditMessage, lastUserMessage, type MessageChangeResult } from '../../../../shared/conversation/editMessage';
import { guiComposer } from '../pages/codexGui/composerBridge';
import { sliceHistory } from '../../../../shared/remote-chat/historyPage';
import type { Request } from '../../../../shared/conversation/types';

/** Run remote edits under the host's activity/queue guards and refresh its local conversation too. */
export async function changeRemoteMessage(body: Record<string, unknown>): Promise<MessageChangeResult> {
  const threadId = body.threadId;
  if (typeof threadId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(threadId)) {
    throw new Error('请选择有效的对话。');
  }
  const controller = getGuiController();
  const release = controller.retainConversation(threadId);
  try { return await changeRetainedMessage(body, threadId); }
  finally { release(); }
}

async function changeRetainedMessage(body: Record<string, unknown>, threadId: string): Promise<MessageChangeResult> {
  const controller = getGuiController();
  if (controller.getSnapshot().connection !== 'ready') await controller.connect({ reuseExisting: true });
  await controller.loadRemoteThread(threadId);
  const state = controller.getSnapshot();
  const before = state.conversations[threadId];
  const last = lastUserMessage(before);
  if (!canEditMessage({ ...state, selected: threadId, archived: false })
    || !last || last.turnId !== body.turnId || last.item.id !== body.itemId || last.item.localEcho) {
    throw new Error('请等待当前操作完成，并刷新对话后重试。');
  }
  controller.setWorkspaceBusy(true);
  try {
    const { settings } = await guiComposer.read(threadId);
    if (body.operation === 'editMessage') await guiComposer.validateSend({ threadId,
      model: typeof body.model === 'string' ? body.model : undefined,
      effort: typeof body.effort === 'string' ? body.effort : undefined });
    const result = await guiApi.request<MessageChangeResult>({ ...body,
      model: settings.model || undefined, effort: settings.effort || undefined, access: settings.access,
      cwd: state.projectOverrides[threadId] } as Request);
    controller.messageEditor.applyResult(before, result);
    return { ...result, thread: sliceHistory(result.thread).thread };
  } finally { controller.setWorkspaceBusy(false); }
}
