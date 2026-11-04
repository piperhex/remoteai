import { getChatPolicy } from '../../../../shared/remote-chat/policy';
import { getGuiController } from '../pages/codexGui/session';
import type { GuiEvent, Thread } from '../../../../shared/conversation/types';
import { guiApi } from '../../../../shared/conversation/api';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';

export async function readRemoteThreadList(body: Record<string, unknown>) {
  if ((body.archived !== undefined && typeof body.archived !== 'boolean')
    || (body.search !== undefined && typeof body.search !== 'string')
    || (body.cursor !== undefined && typeof body.cursor !== 'string')
    || (body.force !== undefined && typeof body.force !== 'boolean')) throw new Error('Invalid request');
  const controller = getGuiController();
  const [page, grouped] = await Promise.all([controller.readThreadList({ archived: body.archived === true,
    search: body.search as string | undefined, cursor: body.cursor as string | undefined },
  { pageSize: getChatPolicy().threadPageSize, force: body.force === true }),
  readGroupedSummaries(body)]);
  // Supplement the first page without changing its cursor. Later pages deduplicate by thread ID.
  const listed = new Set(page.data.map(thread => thread.id));
  return { ...page, data: [...page.data, ...grouped.filter(thread => !listed.has(thread.id))] };
}

async function readGroupedSummaries(body: Record<string, unknown>): Promise<Thread[]> {
  if (body.cursor || body.search) return [];
  const grouping = getGuiController().getSnapshot().grouping;
  const groups = new Set(grouping.groups.map(group => group.id));
  const threadIds = Object.entries(grouping.threads)
    .filter(([, groupId]) => groupId !== null && groups.has(groupId)).map(([id]) => id);
  if (!threadIds.length) return [];
  try {
    const summaries = await guiApi.request<Thread[]>({
      operation: 'groupThreadSummaries', threadIds, archived: body.archived === true,
    });
    const sidebar = guiSidebar.snapshot();
    return summaries.map(thread => ({ ...thread,
      status: { type: sidebar.threads[thread.id]?.running ? 'active' : 'idle' } }));
  } catch {
    // A temporarily unavailable index must not prevent the normal paginated list from opening.
    console.warn('[remote-chat] Group summaries unavailable; retaining normal thread pagination.');
    return [];
  }
}

/** Host notifications keep the shared list warm even before the local chat page is opened. */
export function receiveRemoteThreadListEvent(event: GuiEvent) {
  getGuiController().receiveThreadListEvent(event);
}

export function completeRemoteThreadListWrite(body: Record<string, unknown>, result: unknown) {
  const { operation, threadId } = body;
  if (operation === 'start' || operation === 'resume') {
    const thread = (result as { thread?: Thread } | null)?.thread;
    if (thread) receiveRemoteThreadListEvent({ method: 'thread/started', params: { thread } });
  }
  if (typeof threadId !== 'string') return;
  if (operation === 'rename' && typeof body.name === 'string') {
    receiveRemoteThreadListEvent({ method: 'thread/name/updated', params: { threadId, threadName: body.name } });
  }
  if (operation === 'archive' || operation === 'unarchive') {
    receiveRemoteThreadListEvent({ method: operation === 'archive' ? 'thread/archived' : 'thread/unarchived',
      params: { threadId } });
  }
  if (operation === 'send' && typeof body.text === 'string') {
    receiveRemoteThreadListEvent({ method: 'item/completed', params: { threadId,
      item: { id: 'preview', type: 'userMessage', content: [{ type: 'text', text: body.text }] } } });
  }
}
