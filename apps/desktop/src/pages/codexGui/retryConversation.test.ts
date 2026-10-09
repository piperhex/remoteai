// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from './controller';
import { guiApi } from './api';
import { testModels } from './testModels';
import { conversationRetryState, retryConversation } from './ConversationRetryProvider';
import { CONTINUE_MESSAGE } from './continuation';
import { MODEL_CAPACITY_MESSAGE } from './requestError';
import type { GuiEvent, GuiState, Thread } from './types';

vi.mock('./api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn() } }));
let controller: GuiController;
let receive: (event: GuiEvent) => void;
const target = { threadId: 'one', turnId: 'failed' };
const thread: Thread = { id: 'one', cwd: '/project', updatedAt: 1, preview: '',
  turns: [{ id: 'failed', status: 'failed', items: [], error: { message: 'HTTP 502' } }] };
beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  controller = new GuiController();
  vi.spyOn(controller.titles, 'generate').mockResolvedValue();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async callback => { receive = callback; return vi.fn<() => void>(); });
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'models') return { data: testModels, nextCursor: null };
    if (request.operation === 'list') return { data: [], nextCursor: null };
    if (request.operation === 'send') return { turn: { id: 'continued', status: 'inProgress', items: [] } };
    return { thread };
  });
  await controller.connect();
  await controller.select('one');
});
afterEach(() => { controller.dispose(); vi.useRealTimers(); });

it('continues the same conversation using current settings and cancels automatic retry first', async () => {
  controller.settings({ model: testModels[0].model, effort: 'high', access: 'read-only' });
  const cancel = vi.spyOn(controller.capacityRetry, 'cancel');
  expect(await retryConversation(controller, target)).toBe(true);
  expect(cancel).toHaveBeenCalled();
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: 'send', threadId: 'one',
    text: CONTINUE_MESSAGE, images: [], model: testModels[0].model, effort: 'high', access: 'read-only' }));
  expect(await retryConversation(controller, target)).toBe(false);
  expect(controller.getSnapshot().conversations.one.activeTurn).toBe('continued');
});

it('rejects stale actions after another turn starts or the selection changes', async () => {
  receive({ method: 'turn/started', params: { threadId: 'one',
    turn: { id: 'new', status: 'inProgress', items: [] } } });
  expect(await retryConversation(controller, target)).toBe(false);
  controller.newConversation();
  expect(await retryConversation(controller, target)).toBe(false);
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === 'send')).toHaveLength(0);
});

it('cancels the capacity countdown before a manual retry so it cannot submit again', async () => {
  vi.useFakeTimers();
  controller.capacityRetry.setActive(true);
  receive({ method: 'turn/started', params: { threadId: 'one',
    turn: { id: 'capacity', status: 'inProgress', items: [] } } });
  receive({ method: 'turn/completed', params: { threadId: 'one',
    turn: { id: 'capacity', status: 'failed', items: [], error: { message: MODEL_CAPACITY_MESSAGE } } } });
  expect(controller.getSnapshot().capacityRetry?.seconds).toBe(1);
  expect(await retryConversation(controller, { threadId: 'one', turnId: 'capacity' })).toBe(true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(controller.getSnapshot().capacityRetry).toBeUndefined();
  expect(vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === 'send')).toHaveLength(1);
});

it.each<Partial<GuiState>>([{ sending: true }, { connection: 'offline' }, { archived: true },
  { compacting: 'one' }, { workspaceBusy: true }, { modelSettingsLoading: true }])(
  'blocks retry while busy: %j', patch => {
  expect(conversationRetryState({ ...controller.getSnapshot(), ...patch }).disabled).toBe(true);
});
