// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from '../pages/codexGui/controller';
import { guiApi } from '../../../../shared/conversation/api';
import { getGuiController } from '../pages/codexGui/session';
import { guiComposer } from '../pages/codexGui/composerBridge';
import { ChatOperations } from './operations';
import type { Thread } from '../../../../shared/conversation/types';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: {
  connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn(),
} }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: vi.fn() }));
vi.mock('../pages/codexGui/composerBridge', () => ({ guiComposer: { read: vi.fn(), validateSend: vi.fn() } }));
const source: Thread = { id: 'remote', cwd: '', preview: '', updatedAt: 1, turns: [
  { id: 'last', status: 'completed', items: [{ id: 'user', type: 'userMessage',
    content: [{ type: 'text', text: 'original' }] }, { id: 'reply', type: 'agentMessage', text: 'reply' }] },
] };
let controller: GuiController;
const request = { kind: 'request' as const, id: 'edit-1', method: 'request' as const,
  body: { operation: 'deleteMessage', threadId: 'remote', turnId: 'last', itemId: 'user' } };

beforeEach(async () => {
  vi.resetAllMocks(); localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(vi.fn());
  vi.mocked(guiApi.request).mockImplementation(async body => {
    if (body.operation === 'list' || body.operation === 'models') return { data: [], nextCursor: null };
    if (body.operation === 'deleteMessage' || body.operation === 'editMessage') return { thread: { ...source, turns: [] } };
    return { thread: source };
  });
  vi.mocked(guiComposer.read).mockResolvedValue({ settings: { model: 'model', effort: 'high', access: 'read-only' } } as never);
  controller = new GuiController(); vi.mocked(getGuiController).mockReturnValue(controller);
  await controller.connect(); controller.newConversation();
});
afterEach(() => controller.dispose());

it('deletes remotely exactly once and updates host history without switching the host selection', async () => {
  const operations = new ChatOperations();
  const first = await operations.execute(request);
  expect(first.error).toBeUndefined();
  expect(await operations.execute(request)).toEqual(first);
  expect(vi.mocked(guiApi.request).mock.calls.filter(([body]) => body.operation === 'deleteMessage')).toHaveLength(1);
  expect(controller.getSnapshot().selected).toBeNull();
  expect(controller.getSnapshot().conversations.remote.turns).toEqual([]);
  expect(controller.getSnapshot().workspaceBusy).toBe(false);
});

it('rejects a stale remote target before changing history', async () => {
  const result = await new ChatOperations().execute({ ...request, body: { ...request.body, itemId: 'stale' } });
  expect(result.error).toContain('刷新对话');
  expect(vi.mocked(guiApi.request).mock.calls.some(([body]) => body.operation === 'deleteMessage')).toBe(false);
});

it('uses host settings for a remote edit and preserves attachments in the request', async () => {
  const result = await new ChatOperations().execute({ ...request, body: { ...request.body, operation: 'editMessage',
    text: 'edited', removedImageIndexes: [0], access: 'danger-full-access' } });
  expect(result.error).toBeUndefined();
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: 'editMessage', text: 'edited',
    removedImageIndexes: [0], model: 'model', effort: 'high', access: 'read-only' }));
});
