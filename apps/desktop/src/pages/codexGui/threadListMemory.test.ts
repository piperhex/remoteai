// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from './controller';
import { guiApi } from '../../../../../shared/conversation/api';
import type { GuiEvent, Thread } from '../../../../../shared/conversation/types';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const thread: Thread = { id: 'one', preview: 'question', cwd: '/project', updatedAt: 1 };
const older = { ...thread, id: 'older' };
let controller: GuiController;
let receive: (event: GuiEvent) => void;
const reads = () => vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === 'list');

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async callback => { receive = callback; return () => {}; });
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'list') return request.archived ? { data: [], nextCursor: null }
      : request.cursor ? { data: [older], nextCursor: null } : { data: [thread], nextCursor: 'older' };
    if (request.operation === 'models') return { data: [], nextCursor: null };
    return { thread };
  });
  controller = new GuiController();
  await controller.connect();
});
afterEach(() => controller.dispose());

it('retains pages across tab changes and new drafts without reading again', async () => {
  await controller.refresh(true);
  controller.filter('', true);
  await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
  controller.filter('', false);
  expect(controller.getSnapshot().loading).toBe(false);
  controller.newConversation();
  expect(controller.getSnapshot().threads.map(entry => entry.id)).toEqual(['one', 'older']);
  expect(controller.getSnapshot().cursor).toBeNull();
  expect(reads()).toHaveLength(3);
});

it('maintains unseen tabs after successful rename and archive writes', async () => {
  controller.filter('', true);
  await vi.waitFor(() => expect(controller.getSnapshot().loading).toBe(false));
  controller.filter('', false);
  await controller.manage('rename', 'one', 'New title');
  await controller.manage('archive', 'one');
  expect(controller.getSnapshot().threads).toEqual([]);
  controller.filter('', true);
  expect(controller.getSnapshot().threads[0].name).toBe('New title');
  await controller.manage('unarchive', 'one');
  expect(controller.getSnapshot().threads[0].name).toBe('New title');
  expect(reads()).toHaveLength(2);
});

it('updates live metadata and removes chats without another list request', () => {
  receive({ method: 'thread/started', params: { thread: { ...thread, id: 'new', turns: [] } } });
  receive({ method: 'thread/name/updated', params: { threadId: 'new', threadName: 'Renamed' } });
  expect(controller.getSnapshot().threads[0]).toMatchObject({ id: 'new', name: 'Renamed' });
  receive({ method: 'thread/deleted', params: { threadId: 'one' } });
  expect(controller.getSnapshot().threads.map(entry => entry.id)).toEqual(['new']);
  expect(reads()).toHaveLength(1);
});

it('revalidates manually and after a disconnected subscription', async () => {
  await controller.refresh();
  expect(reads()).toHaveLength(2);
  controller.suspend();
  await controller.connect();
  expect(reads()).toHaveLength(3);
});
