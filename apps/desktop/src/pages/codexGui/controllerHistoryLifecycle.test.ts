// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from './controller';
import { guiApi } from '../../../../../shared/conversation/api';
import { sliceHistory } from '../../../../../shared/remote-chat/historyPage';
import type { Thread } from '../../../../../shared/conversation/types';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
const thread: Thread = { id: 'chat', cwd: '', preview: '', updatedAt: 1,
  turns: [{ id: 'turn', status: 'completed', items: Array.from({ length: 25 }, (_, index) => ({
    id: String(index), type: 'agentMessage', text: `Message ${index}`,
  })) }] };
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });

it.each(['suspend', 'dispose'] as const)('invalidates pending pagination across %s and activation', async action => {
  const controller = new GuiController();
  const latest = sliceHistory(thread);
  vi.mocked(guiApi.request).mockResolvedValue(latest);
  await controller.select(thread.id);
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation(request => request.operation === 'read'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}));
  const reading = controller.loadOlderHistory();
  controller[action]();
  controller.activate();
  const before = controller.getSnapshot().conversations.chat;
  finish(sliceHistory(thread, { start: latest.page.start, older: true }));
  await reading;
  expect(controller.getSnapshot().conversations.chat).toBe(before);
  controller.dispose();
});
