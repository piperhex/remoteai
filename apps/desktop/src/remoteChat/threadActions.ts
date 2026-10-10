import { getGuiController } from '../pages/codexGui/session';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';

const THREAD_ID_LIMIT = 200;

export function pinRemoteThread(body: Record<string, unknown>) {
  const { threadId, pinned } = body;
  if (typeof threadId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(threadId) || typeof pinned !== 'boolean') {
    throw new Error('请选择有效的对话。');
  }
  const controller = getGuiController();
  if (controller.getSnapshot().pins.includes(threadId) !== pinned) controller.pin(threadId);
  return guiSidebar.observe([]);
}

/** Use the desktop deletion flow so remote clients share its queue, approval and active-turn guards. */
export async function deleteRemoteThread(threadId: unknown) {
  if (typeof threadId !== 'string' || !threadId.trim() || threadId.length > THREAD_ID_LIMIT) {
    throw new Error('请选择有效的对话。');
  }
  const controller = getGuiController();
  if (controller.getSnapshot().connection !== 'ready') await controller.connect({ reuseExisting: true });
  if (!await controller.deleteThread(threadId)) {
    throw new Error(controller.getSnapshot().error || '删除未完成，请稍后重试。');
  }
  return {};
}
