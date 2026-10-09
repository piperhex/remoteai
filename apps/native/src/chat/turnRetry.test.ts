import { expect, it, vi } from 'vitest';
import { chatRetryState, retryChat } from '../../../../shared/remote-chat/ChatRetryProvider';
import { initialChatState, type ChatState } from '../../../../shared/remote-chat/client/types';
import { CONTINUE_MESSAGE } from '../../../../shared/remote-chat/composerAction';

const target = { threadId: 'thread', turnId: 'failed' };
const state = (): ChatState => ({ ...initialChatState(), ready: true, mode: 'relay',
  selected: { id: 'thread', cwd: '/project', preview: '', updatedAt: 1,
    turns: [{ id: 'failed', status: 'failed', items: [], error: { message: 'HTTP 502' } }] } });

it('continues the selected remote conversation with the current access mode', async () => {
  const current = state();
  current.settings.access = 'read-only';
  const controller = { snapshot: () => current, send: vi.fn().mockResolvedValue(true) };
  expect(await retryChat(controller, target)).toBe(true);
  expect(controller.send).toHaveBeenCalledWith({ text: CONTINUE_MESSAGE, access: 'read-only' });
  current.selected = { ...current.selected!, id: 'another-thread' };
  expect(await retryChat(controller, target)).toBe(false);
  expect(controller.send).toHaveBeenCalledOnce();
});

it.each<Partial<ChatState>>([{ ready: false }, { sending: true }, { selectedArchived: true }, { settingsBusy: true },
  { compacting: 'thread' }, { queueBusy: true }, { workspaceBusy: true }, { threadActionBusy: 'thread' },
  { queue: { revision: 1, threads: { thread: [{ id: 'queued', text: 'next', imageCount: 0,
    attachmentCount: 0, busy: false }] } } }])('prevents a remote retry when unavailable: %j', async patch => {
  const current = { ...state(), ...patch };
  const controller = { snapshot: () => current, send: vi.fn().mockResolvedValue(true) };
  expect(chatRetryState(current).disabled).toBe(true);
  expect(await retryChat(controller, target)).toBe(false);
  expect(controller.send).not.toHaveBeenCalled();
});
