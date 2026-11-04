// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from '../pages/codexGui/controller';
import { guiApi } from '../../../../shared/conversation/api';
import { getGuiController } from '../pages/codexGui/session';
import { ChatOperations } from './operations';
import { DEFAULT_CHAT_POLICY } from '../../../../shared/chat/chatPolicy';
import { setChatPolicy } from '../../../../shared/remote-chat/policy';
import type { ListResponse, Thread } from '../../../../shared/conversation/types';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: vi.fn() }));
const thread: Thread = { id: 'one', name: 'Original', preview: '', cwd: '/project', updatedAt: 1 };
let controller: GuiController;
let operations: ChatOperations;
let serial = 0;
const execute = (body: Record<string, unknown>) => operations.execute({
  kind: 'request', method: 'request', id: `list-cache:${++serial}`, body,
});
const reads = () => vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === 'list');

beforeEach(async () => {
  vi.resetAllMocks(); localStorage.clear();
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, threadPageSize: 1 });
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(() => {});
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'list') return { data: request.archived ? [] : [thread, { ...thread, id: 'two' }],
      nextCursor: null };
    if (request.operation === 'models') return { data: [], nextCursor: null };
    return {};
  });
  controller = new GuiController();
  vi.mocked(getGuiController).mockReturnValue(controller);
  operations = new ChatOperations();
  await controller.connect();
});
afterEach(() => { controller.dispose(); setChatPolicy(DEFAULT_CHAT_POLICY); });

it('serves several remote clients and paginated reads from the local list cache', async () => {
  const first = await execute({ operation: 'list', archived: false });
  expect(first.error).toBeUndefined();
  const page = first.data as ListResponse<Thread>;
  expect(page.data).toEqual([thread]);
  expect(page.nextCursor).toBeTruthy();
  const second = await execute({ operation: 'list', archived: false, cursor: page.nextCursor });
  expect(second.data).toMatchObject({ data: [{ id: 'two' }], nextCursor: null });
  await execute({ operation: 'list', archived: false });
  expect(reads()).toHaveLength(1);
  expect(controller.getSnapshot().threads.map(entry => entry.id)).toEqual(['one', 'two']);
});

it('shares successful remote and local writes immediately without scanning the list again', async () => {
  await execute({ operation: 'rename', threadId: 'one', name: 'Remote title' });
  expect(controller.getSnapshot().threads[0].name).toBe('Remote title');
  await controller.manage('rename', 'one', 'Local title');
  expect((await execute({ operation: 'list', archived: false })).data)
    .toMatchObject({ data: [{ id: 'one', name: 'Local title' }] });
  await execute({ operation: 'archive', threadId: 'one' });
  expect(controller.getSnapshot().threads.map(entry => entry.id)).toEqual(['two']);
  expect((await execute({ operation: 'list', archived: false })).data).toMatchObject({ data: [{ id: 'two' }] });
  expect(reads()).toHaveLength(1);
});

it('maintains the shared cache from host events before opening the local page', async () => {
  const created = { ...thread, id: 'new', name: 'Remote draft', turns: [] };
  operations.prepareEvent({ method: 'thread/started', params: { thread: created } });
  expect(controller.getSnapshot().threads[0]).toMatchObject({ id: 'new', name: 'Remote draft' });
  expect((await execute({ operation: 'list', archived: false })).data).toMatchObject({ data: [{ id: 'new' }] });
  operations.prepareEvent({ method: 'thread/deleted', params: { threadId: 'new' } });
  expect(controller.getSnapshot().threads[0].id).toBe('one');
  expect(reads()).toHaveLength(1);
});

it('honors manual remote refresh and rejects a cursor for another filter', async () => {
  const result = await execute({ operation: 'list', archived: false });
  const cursor = (result.data as ListResponse<Thread>).nextCursor;
  expect((await execute({ operation: 'list', archived: true, cursor })).error).toBeDefined();
  await execute({ operation: 'list', archived: false, force: true });
  expect(reads()).toHaveLength(2);
});
