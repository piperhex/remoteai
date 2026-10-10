// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { guiApi } from '../pages/codexGui/api';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';
import { initialState } from '../pages/codexGui/preferences';
import type { GuiState, Thread } from '../pages/codexGui/types';
import { forkRemoteConversation } from './forkConversation';
import { pinRemoteThread } from './threadActions';

const host = vi.hoisted(() => ({ getSnapshot: vi.fn(), connect: vi.fn(), refresh: vi.fn(), pin: vi.fn(),
  select: vi.fn(), modelSettings: { ready: vi.fn(), created: vi.fn() } }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: () => host }));
vi.mock('../pages/codexGui/api', () => ({ guiApi: { request: vi.fn() } }));
vi.mock('../pages/codexGui/sidebarBridge', () => ({ guiSidebar: { observe: vi.fn() } }));
let state: GuiState;
const source: Thread = { id: 'source', cwd: 'D:/project', preview: '', updatedAt: 1,
  turns: [{ id: 'last', status: 'completed', items: [] }] };
const fork: Thread = { ...source, id: 'fork' };

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  state = { ...initialState(), connection: 'ready', selected: 'unrelated',
    projectOverrides: { source: 'D:/override' } };
  host.getSnapshot.mockImplementation(() => state);
  host.modelSettings.ready.mockResolvedValue({ model: 'source-model', effort: 'high' });
  host.refresh.mockResolvedValue(undefined);
  vi.mocked(guiApi.request).mockImplementation(async request => ({ thread: request.operation === 'fork' ? fork : source }));
});

it('forks the latest host history once, inherits source settings, and leaves the host selection unchanged', async () => {
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, id: 'fork-one', method: 'request' as const,
    body: { operation: 'forkLatest', threadId: source.id } };
  const first = operations.execute(request);
  const retry = operations.execute(request);
  expect(await first).toEqual(await retry);
  expect(await first).toMatchObject({ data: { thread: { id: fork.id } } });
  expect((await first).data).not.toHaveProperty('thread.turns');
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: 'fork', threadId: source.id, turnId: 'last',
    access: state.settings.access, cwd: 'D:/override' });
  expect(host.modelSettings.created).toHaveBeenCalledWith('fork', { model: 'source-model', effort: 'high' });
  expect(host.modelSettings.ready).toHaveBeenLastCalledWith('fork');
  expect(state.selected).toBe('unrelated');
  expect(host.select).not.toHaveBeenCalled();
});

it.each([
  { turns: [], error: '还没有' },
  { turns: [{ id: 'active', status: 'inProgress', items: [] }], error: '当前回复' },
])('rejects unavailable source history: $error', async ({ turns, error }) => {
  vi.mocked(guiApi.request).mockResolvedValue({ thread: { ...source, turns } });
  await expect(forkRemoteConversation(source.id)).rejects.toThrow(error);
  expect(guiApi.request).toHaveBeenCalledExactlyOnceWith({ operation: 'read', threadId: source.id });
});

it('rechecks host state after a pending read and refuses a conversation that started replying', async () => {
  let finish!: (value: { thread: Thread }) => void;
  vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = forkRemoteConversation(source.id);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  state.pendingRequest = { threadId: source.id, startedAtMs: 1 };
  finish({ thread: source });
  await expect(pending).rejects.toThrow('当前回复');
  expect(guiApi.request).toHaveBeenCalledTimes(1);
});

it('sets pin state idempotently and publishes the shared sidebar', async () => {
  host.pin.mockImplementation((id: string) => { state = { ...state, pins: [id] }; });
  vi.mocked(guiSidebar.observe).mockImplementation(() => ({ revision: 1, pins: state.pins,
    threads: {}, readState: {} }));
  const body = { threadId: source.id, pinned: true };
  expect(pinRemoteThread(body).pins).toEqual([source.id]);
  expect(pinRemoteThread(body).pins).toEqual([source.id]);
  expect(host.pin).toHaveBeenCalledExactlyOnceWith(source.id);
});

it.each([undefined, '', '../source', 'source\n', 3])('rejects an invalid conversation id: %j', async threadId => {
  await expect(forkRemoteConversation(threadId)).rejects.toThrow('有效的对话');
  expect(() => pinRemoteThread({ threadId, pinned: true })).toThrow('有效的对话');
  expect(guiApi.request).not.toHaveBeenCalled();
  expect(host.pin).not.toHaveBeenCalled();
});
