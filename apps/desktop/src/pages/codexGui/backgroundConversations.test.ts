// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from './controller';
import { guiApi } from '../../../../../shared/conversation/api';
import type { GuiEvent, Thread } from '../../../../../shared/conversation/types';
import { testModels } from '../../../../../shared/conversation/testing/models';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: {
  connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn(),
} }));
let receive: (event: GuiEvent) => void;
let controller: GuiController;
const thread = (id: string): Thread => ({ id, cwd: '', preview: id, updatedAt: 1, turns: [] });
beforeEach(async () => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async callback => { receive = callback; return vi.fn<() => void>(); });
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'models') return { data: testModels, nextCursor: null };
    if (request.operation === 'list') return { data: [thread('one'), thread('two')], nextCursor: null };
    if (request.operation === 'read') return { thread: thread(request.threadId), page: { hasMore: false } };
    return {};
  });
  controller = new GuiController();
  await controller.connect();
});
afterEach(() => controller.dispose());

it.each(['item/agentMessage/delta', 'item/plan/delta', 'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta', 'item/reasoning/summaryTextDelta', 'item/reasoning/textDelta'])(
  'ignores background %s without reading history or notifying React after a frame', async method => {
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === 'read')).toHaveLength(0);
  await controller.select('one');
  receive({ method: 'thread/started', params: { thread: thread('two') } });
  receive({ method: 'turn/started', params: { threadId: 'two', turn: { id: 't', status: 'inProgress', items: [] } } });
  const updated = vi.fn(); const stop = controller.subscribe(updated);
  for (let index = 0; index < 1000; index++) {
    receive({ method, params: { threadId: 'two', turnId: 't', itemId: 'i',
      delta: 'x'.repeat(1024) } });
  }
  expect(updated).not.toHaveBeenCalled();
  // Wait past StreamFrame's fallback so a mistakenly queued delta cannot escape the assertion.
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(updated).not.toHaveBeenCalled();
  expect(controller.getSnapshot().conversations.two.turns[0].items).toEqual([]);
  const reads = vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === 'read');
  expect(reads).toHaveLength(1);
  expect(reads[0][0]).toMatchObject({ threadId: 'one' });
  stop();
});

it('keeps background phases, approvals, completion and unread state without retaining item bodies', async () => {
  await controller.select('two'); await controller.select('one');
  receive({ method: 'turn/started', params: { threadId: 'two', turn: { id: 't', status: 'inProgress', items: [] } } });
  receive({ method: 'item/started', params: { threadId: 'two', turnId: 't',
    item: { id: 'i', type: 'commandExecution', status: 'inProgress', aggregatedOutput: 'x'.repeat(1_000_000) } } });
  expect(controller.getSnapshot().conversations.two.processing?.phase).toBe('command');
  expect(controller.getSnapshot().conversations.two.turns[0].items).toEqual([]);
  receive({ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'two', turnId: 't' } });
  expect(controller.getSnapshot().approvals).toHaveLength(1);
  receive({ method: 'turn/completed', params: { threadId: 'two', turn: { id: 't', status: 'completed',
    items: [{ id: 'i', type: 'commandExecution', aggregatedOutput: 'x'.repeat(1_000_000) }] } } });
  expect(controller.getSnapshot().conversations.two.activeTurn).toBeNull();
  expect(controller.getSnapshot().conversations.two.turns[0].items).toEqual([]);
  expect(controller.getSnapshot().approvals).toHaveLength(0);
  expect(controller.getSnapshot().threadReadState.two.unread).toBe(true);
});
