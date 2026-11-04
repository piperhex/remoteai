import { getChatPolicy } from '../../../../shared/remote-chat/policy';
import { getGuiController } from '../pages/codexGui/session';
import type { GuiEvent, Thread } from '../../../../shared/conversation/types';

export function readRemoteThreadList(body: Record<string, unknown>) {
  if ((body.archived !== undefined && typeof body.archived !== 'boolean')
    || (body.search !== undefined && typeof body.search !== 'string')
    || (body.cursor !== undefined && typeof body.cursor !== 'string')
    || (body.force !== undefined && typeof body.force !== 'boolean')) throw new Error('Invalid request');
  return getGuiController().readThreadList({ archived: body.archived === true,
    search: body.search as string | undefined, cursor: body.cursor as string | undefined },
  { pageSize: getChatPolicy().threadPageSize, force: body.force === true });
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
