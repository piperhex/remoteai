// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from './controller';
import { guiApi } from '../../../../../shared/conversation/api';
import type { GuiEvent, Thread } from '../../../../../shared/conversation/types';
import { testModels } from '../../../../../shared/conversation/testing/models';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn() } }));
let controller: GuiController;
let receive: (event: GuiEvent) => void;
const thread = (id: string): Thread => ({ id, cwd: '', preview: id, updatedAt: 1,
  turns: [{ id: 'turn', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: 'x'.repeat(10_000) }] }],
});
beforeEach(async () => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async listener => { receive = listener; return () => {}; });
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'list') return { data: [thread('a'), thread('b')], nextCursor: null };
    if (request.operation === 'models') return { data: testModels, nextCursor: null };
    return 'threadId' in request && request.threadId ? { thread: thread(request.threadId) } : {};
  });
  controller = new GuiController(undefined, 0);
  await controller.connect();
});
afterEach(() => controller.dispose());

it('rereads evicted history while keeping the list, preferences and current conversation', async () => {
  await controller.select('a');
  controller.pin('a');
  await controller.select('b');
  expect(Object.keys(controller.getSnapshot().conversations)).toEqual(['b']);
  expect(controller.getSnapshot().pins).toContain('a');
  expect(controller.getSnapshot().threads.map(entry => entry.id)).toContain('a');
  expect(controller.getSnapshot().threads.every(entry => !entry.turns)).toBe(true);
  await controller.select('a');
  expect(controller.getSnapshot().conversations.a.turns[0].items[0].text).toHaveLength(10_000);
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) =>
    request.operation === 'read' && request.threadId === 'a')).toHaveLength(2);
});

it('retains phone history throughout asynchronous work and preserves approvals until resolved', async () => {
  const release = controller.retainConversation('phone');
  await controller.loadRemoteThread('phone');
  controller.clearError();
  expect(controller.getSnapshot().conversations.phone).toBeDefined();
  receive({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: 'phone' } });
  release();
  expect(controller.getSnapshot().conversations.phone).toBeDefined();
  receive({ method: 'serverRequest/resolved', params: { requestId: 'approval' } });
  expect(controller.getSnapshot().conversations.phone).toBeUndefined();
});

it('keeps a background running turn and releases completed history after its final event', async () => {
  const release = controller.retainConversation('phone');
  await controller.loadRemoteThread('phone');
  receive({ method: 'turn/started', params: { threadId: 'phone', turn: { id: 'live', status: 'inProgress', items: [] } } });
  release();
  expect(controller.getSnapshot().conversations.phone.activeTurn).toBe('live');
  receive({ method: 'turn/completed', params: { threadId: 'phone', turn: { id: 'live', status: 'completed', items: [] } } });
  expect(controller.getSnapshot().conversations.phone).toBeUndefined();
  expect(controller.getSnapshot().threadReadState.phone).toMatchObject({ turnId: 'live', unread: true });
});
